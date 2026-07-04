"""Meta-Scheduler: 意图分类、任务分解、DAG 校验。

核心流程: classify → decompose → validate → TaskDAG
"""

import json
import logging
import uuid
import re
from openai import AsyncOpenAI

from agent_swarm.models import TaskDAG, AgentConfig, Subtask, DivergenceWarning
from agent_swarm.prompts.classifier import CLASSIFIER_SYSTEM_PROMPT, CLASSIFIER_USER_TEMPLATE
from agent_swarm.prompts.decomposer import (
    DECOMPOSER_SYSTEM_PROMPT,
    DECOMPOSER_USER_TEMPLATE,
    FEW_SHOT_EXAMPLES,
)

logger = logging.getLogger(__name__)


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
    """元调度器: 负责意图分类、任务分解、DAG 校验。

    使用两个 LLM:
    - classifier_model (小模型, 1B-4B): 快速意图分类
    - decomposer_model (中等模型, 7B-14B): 任务拆分 + Agent 配置生成

    用法:
        scheduler = MetaScheduler(base_url="http://localhost:11434/v1", api_key="ollama")
        dag = await scheduler.process("调研2025年AI芯片市场")
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        classifier_model: str = "qwen3:4b",
        decomposer_model: str = "qwen3:14b",
    ):
        self.client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        self.classifier_model = classifier_model
        self.decomposer_model = decomposer_model
        self.router = Router()
        self._project_context: str | None = None

    def set_project(self, description: str):
        self._project_context = description

    def check_if_divergent(self, query: str) -> DivergenceWarning | None:
        if not self._project_context:
            return None

        context_lower = self._project_context.lower()
        query_lower = query.lower()

        # 简单启发式：提取项目描述中的关键词，检查新查询是否含这些词
        keywords = set(context_lower.split()) - {
            "的", "和", "与", "在", "是", "了", "the", "a", "an", "is", "of", "to", "in", "for"
        }
        # 保留有意义的词（长度 > 1 的字母/中文词）
        keywords = {k for k in keywords if len(k) > 1}

        overlap = sum(1 for kw in keywords if kw in query_lower)
        if overlap == 0 and len(keywords) > 3:
            return DivergenceWarning(
                diverged=True,
                current_project=f'当前项目: "{self._project_context[:80]}"',
                new_task_summary=f'新任务: "{query[:80]}"',
                suggestion=(
                    "检测到新任务与当前项目主题无关。"
                    "建议为该任务创建独立项目目录（如 mkdir new-project/），"
                    "避免与现有代码和 checkpoint 混淆。继续在当前目录执行？"
                ),
            )
        return DivergenceWarning(diverged=False)

    async def process(self, query: str) -> TaskDAG:
        """完整处理流水线: classify → decompose → validate。"""
        intent = await self.classify(query)
        dag = await self.decompose(query, intent)

        # 更新 Router 的工具列表校验
        all_tools = set()
        for s in dag.subtasks:
            all_tools.update(s.agent_config.tools)
        # MVP: 不做严格工具校验，允许 Decomposer 定义的任何工具名
        # self.router.available_tools = list(all_tools)

        self.router.validate(dag)
        return dag

    async def classify(self, query: str) -> str:
        """意图分类 - 用小模型快速判断任务类型。"""
        user_prompt = CLASSIFIER_USER_TEMPLATE.format(query=query)

        response = await self._call_llm(
            model=self.classifier_model,
            system_prompt=CLASSIFIER_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.1,
        )

        intent = response.strip().lower()
        valid_intents = {"research", "code", "write", "analyze", "multi"}
        if intent not in valid_intents:
            logger.warning(f"Unknown intent '{intent}', defaulting to 'multi'")
            intent = "multi"

        return intent

    async def decompose(self, query: str, intent: str) -> TaskDAG:
        """任务分解 - 拆分任务 DAG 并现场生成 Agent 配置。"""
        # 构建 few-shot 示例
        few_shot_text = self._build_few_shot()

        user_prompt = (
            few_shot_text
            + "\n---\n"
            + DECOMPOSER_USER_TEMPLATE.format(
                tools="browser, python_executor, file_reader, file_writer, shell, search_engine",
                query=query,
            )
        )

        raw_output = await self._call_llm(
            model=self.decomposer_model,
            system_prompt=DECOMPOSER_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.3,
        )

        # 解析 JSON（处理 LLM 输出中的 markdown 代码块包裹）
        parsed = self._parse_json_output(raw_output)

        task_id = f"task_{uuid.uuid4().hex[:8]}"
        dag = TaskDAG(
            task_id=task_id,
            original_query=query,
            intent=intent,
            subtasks=[Subtask.model_validate(s) for s in parsed["subtasks"]],
            parallel_groups=parsed["parallel_groups"],
        )

        logger.info(f"Decomposed '{query[:50]}...' → {len(dag.subtasks)} subtasks")
        return dag

    @staticmethod
    def _build_few_shot() -> str:
        """构建 few-shot 示例文本。"""
        lines = ["以下是几个任务拆分的示例:\n"]
        for i, example in enumerate(FEW_SHOT_EXAMPLES, 1):
            lines.append(f"[示例 {i}]")
            lines.append(f"用户: {example['query']}")
            lines.append(f"输出: {json.dumps(example['output'], ensure_ascii=False, indent=2)}")
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

    async def _call_llm(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
    ) -> str:
        """调用 LLM (OpenAI 兼容 API)。"""
        response = await self.client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
        )
        content = response.choices[0].message.content or ""
        return content.strip()
