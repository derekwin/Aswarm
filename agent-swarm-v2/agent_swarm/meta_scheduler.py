"""Meta-Scheduler: task decomposition and DAG validation.

Core flow: classify intent → decompose → validate → TaskDAG
"""

import asyncio
import json
import logging
import re
import uuid

from agent_swarm.infrastructure.llm_client import LLMClient
from agent_swarm.models import DivergenceWarning, Subtask, TaskDAG
from agent_swarm.prompts.decomposer import (
    DECOMPOSER_SYSTEM_PROMPT,
    DECOMPOSER_SYSTEM_PROMPT_ZH,
    DECOMPOSER_USER_TEMPLATE,
    load_few_shot_examples,
)

logger = logging.getLogger(__name__)


def _tokenize_cjk(text: str) -> list[str]:
    """Split text into tokens for mixed CJK/Latin text.

    Uses bigram sliding window for CJK characters, whitespace splitting
    for Latin words, so Chinese divergence detection works correctly.
    """
    tokens: list[str] = []
    buf = ""
    for ch in text:
        if ch.isascii() and ch.isalpha():
            buf += ch
        else:
            if buf:
                tokens.append(buf)
                buf = ""
            if not ch.isspace():
                tokens.append(ch)
    if buf:
        tokens.append(buf)

    # Build CJK bigrams from single CJK chars in the token sequence
    result: list[str] = []
    cjk_indices: list[int] = []
    for i, tok in enumerate(tokens):
        if len(tok) == 1 and ord(tok) > 127:
            cjk_indices.append(i)
            result.append(tok)
        else:
            result.append(tok)

    # Add bigrams
    for i in range(len(cjk_indices) - 1):
        a = cjk_indices[i]
        b = cjk_indices[i + 1]
        result.append(tokens[a] + tokens[b])

    return result


CLASSIFIER_SYSTEM_PROMPT = """You are a task classifier. Analyze user input and determine the task type.

Type definitions:
- research: requires searching, collecting information, investigation and analysis
- code: requires writing, modifying, or reviewing code
- write: requires writing documents, reports, or articles
- analyze: requires data analysis, reasoning, or computation
- multi: complex task containing multiple types

Return only the type name, nothing else."""

INTENT_OPTIONS = ("research", "code", "write", "analyze", "multi")


class Router:
    """校验 Decomposer 输出的 DAG 合法性。

    检查项:
    - 子任务 ID 唯一
    - 依赖关系的目标子任务必须存在
    - 无循环依赖
    - parallel_groups 中的子任务必须存在
    - 工具名称必须在可用列表中
    """

    def __init__(self, available_tools: list[str] | None = None):
        self.available_tools = available_tools

    def validate(self, dag: TaskDAG) -> TaskDAG:
        """校验 DAG。校验通过返回原对象，失败抛出 ValueError。"""
        subtask_ids = {s.id for s in dag.subtasks}
        all_tools = set()
        for s in dag.subtasks:
            all_tools.update(s.agent_config.tools)

        # 1. 子任务 ID 唯一
        if len(subtask_ids) != len(dag.subtasks):
            raise ValueError("Duplicate subtask IDs found")

        # 2. 依赖关系检查
        for s in dag.subtasks:
            for dep in s.depends_on:
                if dep not in subtask_ids:
                    raise ValueError(f"Subtask '{s.id}' depends on '{dep}' which is not in subtasks")

        # 3. 循环依赖检查 (DFS)
        self._check_cycles(dag)

        # 4. parallel_groups 中的子任务必须存在
        for group in dag.parallel_groups:
            for tid in group:
                if tid not in subtask_ids:
                    raise ValueError(f"Parallel group contains '{tid}' which is not in subtasks")

        # 5. 工具名称校验
        if self.available_tools:
            unknown = all_tools - set(self.available_tools)
            if unknown:
                raise ValueError(
                    f"Unknown tool(s): {unknown}. Available: {self.available_tools}"
                )

        return dag

    def _check_cycles(self, dag: TaskDAG):
        """DFS 检测循环依赖。"""
        adj = {s.id: set(s.depends_on) for s in dag.subtasks}
        WHITE, GRAY, BLACK = 0, 1, 2
        color = {sid: WHITE for sid in adj}

        def dfs(node):
            color[node] = GRAY
            for neighbor in adj.get(node, []):
                if color[neighbor] == GRAY:
                    raise ValueError(f"Circular dependency detected involving '{node}' and '{neighbor}'")
                if color[neighbor] == WHITE:
                    dfs(neighbor)
            color[node] = BLACK

        for node in adj:
            if color[node] == WHITE:
                dfs(node)


class MetaScheduler:
    """Task decomposition and DAG validation using LLM.

    Uses a decomposer model (14B-35B) to break complex tasks into
    independently executable subtasks with a DAG dependency graph.
    Each subtask includes an on-the-fly Agent configuration.

    Usage:
        scheduler = MetaScheduler(llm=client, available_tools=["shell", "browser"], ...)
        dag = await scheduler.decompose("Research AI chip market")
    """

    DECOMPOSER_TIMEOUT = 300  # seconds

    def __init__(
        self,
        llm: LLMClient,
        available_tools: list[str] | None = None,
        decomposer_model: str = "qwen3.5:35b",
    ):
        self.llm = llm
        self.decomposer_model = decomposer_model
        self.available_tools = available_tools or []
        self.router = Router(self.available_tools)
        self._project_context: str | None = None

    def set_project(self, description: str):
        self._project_context = description

    def check_if_divergent(self, query: str) -> DivergenceWarning | None:
        if not self._project_context:
            return None
        stopwords = {"的", "和", "与", "在", "是", "了", "the", "a", "an", "is", "of", "to", "in", "for", "and", "or", "it", "on", "at", "with", "has", "had", "was", "were", "this", "that", "from"}
        def significant_words(text: str) -> set[str]:
            words = _tokenize_cjk(text.lower())
            return {w for w in words if len(w) > 2 and w not in stopwords}

        context_words = significant_words(self._project_context)
        query_words = significant_words(query)

        if not context_words or not query_words:
            return DivergenceWarning(diverged=False)

        # Jaccard similarity: intersection / union
        intersection = context_words & query_words
        union = context_words | query_words
        similarity = len(intersection) / len(union) if union else 0

        if similarity < 0.05 and len(context_words) > 3:
            return DivergenceWarning(
                diverged=True,
                current_project=f'"{self._project_context[:80]}"',
                new_task_summary=f'"{query[:80]}"',
                suggestion=(
                    "New task appears unrelated to current project. "
                    "Consider creating a separate project directory."
                ),
            )
        return DivergenceWarning(diverged=False)

    async def classify_intent(self, query: str, model: str | None = None) -> str:
        """Use a lightweight LLM call to classify the task intent.

        Uses a small model by default; falls back to decomposer_model if none specified.
        """
        model = model or "qwen3:4b"
        try:
            msg = await self.llm.chat(
                model,
                [
                    {"role": "system", "content": CLASSIFIER_SYSTEM_PROMPT},
                    {"role": "user", "content": f"Classify the following task:\n\n{query}"},
                ],
                temperature=0.1,
            )
            intent = (msg.content or "").strip().lower()
            if intent in INTENT_OPTIONS:
                return intent
            logger.info(f"Unknown intent '{intent}', defaulting to 'multi'")
        except Exception as e:
            logger.warning(f"Intent classification failed: {e}")
        return "multi"

    async def decompose(self, query: str, intent: str | None = None, lang: str = "en") -> TaskDAG:
        """任务分解 - 拆分任务 DAG 并现场生成 Agent 配置。

        If intent is None, it will be auto-classified via LLM.
        """
        if intent is None:
            intent = await self.classify_intent(query)

        system_prompt = DECOMPOSER_SYSTEM_PROMPT_ZH if lang == "zh" else DECOMPOSER_SYSTEM_PROMPT
        few_shot_text = self._build_few_shot()

        tools_str = ", ".join(self.available_tools) if self.available_tools else "browser, python_executor, file_reader, file_writer, shell, search_engine, webfetch"

        user_prompt = (
            few_shot_text
            + "\n---\n"
            + DECOMPOSER_USER_TEMPLATE.format(tools=tools_str, query=query)
        )

        raw_output = await self._call_llm(
            model=self.decomposer_model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.3,
        )

        # 解析 JSON（处理 LLM 输出中的 markdown 代码块包裹）
        parsed = self._parse_json_output(raw_output)

        task_id = f"task_{uuid.uuid4().hex[:8]}"
        dag = TaskDAG(
            task_id=task_id,
            original_query=query,
            intent=parsed.get("intent", intent),
            subtasks=[Subtask.model_validate(s) for s in parsed["subtasks"]],
            parallel_groups=parsed["parallel_groups"],
        )

        logger.info(f"Decomposed '{query[:50]}...' → {len(dag.subtasks)} subtasks (intent: {dag.intent})")
        return dag

    @staticmethod
    def _build_few_shot() -> str:
        examples = load_few_shot_examples()
        lines = ["Here are some task decomposition examples:\n"]
        for i, example in enumerate(examples, 1):
            lines.append(f"[Example {i}]")
            lines.append(f"User: {example['query']}")
            lines.append(f"Output: {json.dumps(example['output'], ensure_ascii=False, indent=2)}")
            lines.append("")
        return "\n".join(lines)

    @staticmethod
    def _parse_json_output(raw: str) -> dict:
        """从 LLM 输出中提取 JSON。"""
        # 尝试直接解析
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        # 尝试提取 ```json ... ``` 代码块
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        # 尝试提取 { ... } 块
        match = re.search(r"\{[\s\S]*\}", raw)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

        raise ValueError(f"Failed to parse JSON from LLM output: {raw[:500]}")

    async def _call_llm(self, model: str, system_prompt: str, user_prompt: str, temperature: float = 0.3) -> str:
        msg = await asyncio.wait_for(
            self.llm.chat(model, [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}], temperature=temperature),
            timeout=getattr(self, 'DECOMPOSER_TIMEOUT', 300),
        )
        return (msg.content or "").strip()
