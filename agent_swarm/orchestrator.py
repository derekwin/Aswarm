"""Swarm Orchestrator - 并行执行引擎，按 DAG 中的 parallel_groups 调度 Agent 执行。"""

import asyncio
import json
import logging
from openai import AsyncOpenAI

from agent_swarm.models import (
    TaskDAG, SwarmState, SubtaskResult, SubtaskState
)
from agent_swarm.mcp_gateway import MCPGateway
from agent_swarm.agent_factory import AgentFactory, Agent
from agent_swarm.state_manager import StateManager

logger = logging.getLogger(__name__)

RETRYABLE_ERRORS = (
    asyncio.TimeoutError,
    ConnectionError,
    ConnectionRefusedError,
    ConnectionResetError,
)

JUDGE_SYSTEM_PROMPT = """You are a quality evaluator. Judge whether an Agent's output meets requirements.
Respond in English only.

Evaluation criteria:
- Information density: does the output contain substantive content (not filler, not "no data found", not "insufficient information")
- Tool usage: did the agent actually call tools and use the returned results
- Task completion: does the output address the task requirements

Return JSON: {"pass": true/false, "reason": "one sentence explaining why"}"""


class ResultAggregator:
    """汇总所有子任务结果，生成最终输出。"""

    def aggregate(self, results: list[SubtaskResult]) -> str:
        parts = []

        for r in results:
            header = f"## Subtask: {r.subtask_id} [{r.state.value}]"
            parts.append(header)

            if r.state == SubtaskState.COMPLETED and r.output:
                parts.append(r.output)
            elif r.state == SubtaskState.FAILED:
                parts.append(f"**FAILED**: {r.error}")

            parts.append("")

        completed = sum(1 for r in results if r.state == SubtaskState.COMPLETED)
        failed = sum(1 for r in results if r.state == SubtaskState.FAILED)
        summary = f"# Result Summary\n\n{completed}/{len(results)} subtasks completed"
        if failed:
            summary += f", {failed} failed"

        return summary + "\n\n" + "\n".join(parts)


class SwarmOrchestrator:
    """集群编排器: 按 parallel_groups 逐组并行执行子任务。

    每个 Agent 通过 LLM (OpenAI 兼容 API) 执行推理和工具调用。
    每完成一个 parallel_group，自动 checkpoint 状态。
    """

    def __init__(
        self,
        gateway: MCPGateway,
        factory: AgentFactory,
        state_manager: StateManager,
        llm_base_url: str,
        llm_api_key: str,
        max_retries: int = 3,
        max_subtask_retries: int = 2,
        judge_model: str = "qwen3:4b",
    ):
        self.gateway = gateway
        self.factory = factory
        self.state_manager = state_manager
        self.llm = AsyncOpenAI(base_url=llm_base_url, api_key=llm_api_key)
        self.aggregator = ResultAggregator()
        self.max_retries = max_retries
        self.max_subtask_retries = max_subtask_retries
        self.judge_model = judge_model  # None = skip quality gate

    async def execute(self, dag: TaskDAG) -> SwarmState:
        state = self.state_manager.initialize(dag.task_id, dag)
        return await self._execute_from_state(state)

    async def resume(self, task_id: str) -> SwarmState:
        state = self.state_manager.resume(task_id)
        return await self._execute_from_state(state)

    async def _execute_from_state(self, state: SwarmState) -> SwarmState:
        dag = state.dag

        while state.current_group < len(dag.parallel_groups):
            group = dag.parallel_groups[state.current_group]
            logger.info(
                f"Executing group {state.current_group + 1}/{len(dag.parallel_groups)}: {group}"
            )

            # Self-correcting retry loop for the current parallel group
            pending_ids = list(group)
            results: dict[str, SubtaskResult] = {}

            for attempt in range(self.max_subtask_retries + 1):  # 0 = first run
                if not pending_ids:
                    break

                if attempt > 0:
                    logger.info(f"  Retry #{attempt}: {pending_ids}")

                batch = []
                for subtask_id in pending_ids:
                    subtask = self._find_subtask(dag, subtask_id)
                    agent = self.factory.create(subtask.agent_config)
                    context = self._gather_context(state, subtask.depends_on)
                    # On retries, enrich the prompt with previous feedback
                    prompt = subtask.prompt
                    if attempt > 0 and subtask_id in results:
                        prompt = self._regenerate_prompt(subtask.prompt, results[subtask_id], attempt)

                    batch.append((subtask_id, self._run_single_agent(subtask_id, agent, prompt, context)))

                batch_results = await asyncio.gather(
                    *(t[1] for t in batch)
                )
                for (sid, _), result in zip(batch, batch_results):
                    result.retry_count += attempt
                    old = results.get(sid)
                    if old:
                        result.retry_history = old.retry_history + [f"Attempt {attempt}: JUDGE={self._judge_summary(result)}"]
                        if result.state == SubtaskState.FAILED and not result.error and old.error:
                            result.error = old.error  # preserve previous error info
                    results[sid] = result

                # Evaluate and determine which need retry
                pending_ids = []
                if self.judge_model:
                    for sid, result in results.items():
                        if result.state == SubtaskState.FAILED and attempt < self.max_subtask_retries:
                            pending_ids.append(sid)
                            logger.warning(f"  [{sid}] FAILED → will retry")
                        elif result.state == SubtaskState.COMPLETED:
                            passed, reason = await self._evaluate_output(
                                self._find_subtask(dag, sid).prompt, result.output or ""
                            )
                            if not passed and attempt < self.max_subtask_retries:
                                pending_ids.append(sid)
                                logger.warning(f"  [{sid}] QUALITY LOW ({reason}) → will retry")
                            else:
                                logger.info(f"  [{sid}] Quality check: {'PASS' if passed else 'MAX RETRIES'}")
                else:
                    # No judge model → only retry FAILED
                    pending_ids = [
                        sid for sid, r in results.items()
                        if r.state == SubtaskState.FAILED and attempt < self.max_subtask_retries
                    ]

            for result in results.values():
                state = self.state_manager.update_subtask(state, result)

            self.state_manager.checkpoint(state)
            state = self.state_manager.advance_group(state)

        self.state_manager.cleanup(dag.task_id, keep_latest=3)
        return state

    # ─── Quality Gate ───

    async def _evaluate_output(self, task_prompt: str, output: str) -> tuple[bool, str]:
        user_prompt = f"Task requirement: {task_prompt[:300]}\n\nAgent output: {output[:600]}"
        try:
            resp = await self.llm.chat.completions.create(
                model=self.judge_model,
                messages=[
                    {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
            )
            raw = resp.choices[0].message.content or '{"pass":true,"reason":"parse error"}'
            parsed = json.loads(raw)
            return parsed.get("pass", True), parsed.get("reason", "")
        except Exception:
            return True, ""  # judge failed → let it pass

    @staticmethod
    def _regenerate_prompt(original: str, prev_result: SubtaskResult, attempt: int) -> str:
        prev_output = (prev_result.output or "")[:200]
        notes = []
        if prev_result.state == SubtaskState.FAILED:
            notes.append(f"Previous attempt failed: {prev_result.error}")
        low_quality_signals = ["data insufficient", "no data found", "information insufficient",
                               "not found", "no results", "数据不足", "未找到", "信息不足"]
        if any(signal.lower() in prev_output.lower() for signal in low_quality_signals):
            notes.append("Previous output lacked substantive content — try different search strategy or execute analysis code")
        if notes:
            return f"[Attempt {attempt + 1}]\n{original}\n\nPrevious issues: {'; '.join(notes)}\nRetry with a different approach."
        return original

    @staticmethod
    def _judge_summary(result: SubtaskResult) -> str:
        if result.state == SubtaskState.FAILED:
            return f"FAILED: {result.error or 'unknown'}"
        return f"COMPLETED ({len(result.output or '')} chars)"

    # ─── Agent 执行 ───

    async def _run_single_agent(
        self, subtask_id: str, agent: Agent, prompt: str, context: str = ""
    ) -> SubtaskResult:
        messages = self._build_messages(agent, prompt, context)
        tools = self._build_tools_schema(agent)

        iteration = 0
        final_output = ""

        while iteration < agent.max_iterations:
            iteration += 1

            try:
                response = await self._call_llm_with_retry(
                    model=agent.model,
                    messages=messages,
                    tools=tools,
                )

                msg = response.choices[0].message

                if msg.tool_calls:
                    messages = await self._handle_tool_calls(agent, msg.tool_calls, messages)
                else:
                    final_output = msg.content or ""
                    messages.append({"role": "assistant", "content": final_output})
                    break

            except Exception as e:
                logger.error(f"Agent '{agent.name}' error at iteration {iteration}: {e}")
                return SubtaskResult(
                    subtask_id=subtask_id,
                    state=SubtaskState.FAILED,
                    error=str(e),
                    iterations_used=iteration,
                )

        if not final_output and messages:
            for m in reversed(messages):
                if m["role"] == "assistant" and m.get("content"):
                    final_output = m["content"]
                    break

        exhausted = iteration >= agent.max_iterations and not final_output
        return SubtaskResult(
            subtask_id=subtask_id,
            state=SubtaskState.COMPLETED if final_output else SubtaskState.FAILED,
            output=final_output or "No output generated",
            error=(
                f"Agent exhausted {agent.max_iterations} iterations without producing output"
                if exhausted else None
            ),
            iterations_used=iteration,
        )

    async def _call_llm_with_retry(self, model: str, messages: list[dict], tools: list[dict]):
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                kwargs = {
                    "model": model,
                    "messages": messages,
                    "temperature": 0.3,
                }
                if tools:
                    kwargs["tools"] = tools
                    kwargs["tool_choice"] = "auto"

                return await self.llm.chat.completions.create(**kwargs)

            except RETRYABLE_ERRORS as e:
                last_error = e
                wait = 2 ** attempt
                logger.warning(
                    f"LLM call attempt {attempt + 1}/{self.max_retries} failed: {e}. "
                    f"Retrying in {wait}s..."
                )
                await asyncio.sleep(wait)

            except Exception:
                raise  # non-retryable, propagate immediately

        raise last_error

    async def _handle_tool_calls(self, agent: Agent, tool_calls, messages: list) -> list:
        for tool_call in tool_calls:
            func_name = tool_call.function.name
            try:
                func_args = json.loads(tool_call.function.arguments)
            except Exception:
                func_args = {}

            logger.info(f"  Agent '{agent.name}' calls tool: {func_name}")

            try:
                tool_result = await self.gateway.call(func_name, **func_args)
                tool_result_str = str(tool_result)
            except Exception as e:
                tool_result_str = f"Tool call failed: {e}"

            messages.append({
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": tool_call.id,
                    "type": "function",
                    "function": {
                        "name": func_name,
                        "arguments": tool_call.function.arguments,
                    },
                }],
            })
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": tool_result_str[:8000],
            })

        return messages

    # ─── 辅助方法 ───

    def _build_tools_schema(self, agent: Agent) -> list[dict]:
        tools = []
        for tool_name in agent.tool_names():
            try:
                schema = self.gateway.get_schema(tool_name)
                tools.append({
                    "type": "function",
                    "function": {
                        "name": schema["name"],
                        "description": schema["description"],
                        "parameters": {
                            "type": "object",
                            "properties": schema["parameters"],
                            "required": list(schema["parameters"].keys()),
                        },
                    },
                })
            except KeyError:
                logger.warning(f"Tool '{tool_name}' not found, skipping")
        return tools

    def _build_messages(self, agent: Agent, prompt: str, context: str) -> list[dict]:
        # 注入工具能力说明和沙箱信息
        capabilities = self._build_capabilities_block(agent.tool_names())
        full_system = agent.system_prompt + capabilities

        messages = [{"role": "system", "content": full_system}]
        if context:
            messages.append({
                "role": "system",
                "content": f"Output from upstream agents (reference context):\n{context}",
            })
        messages.append({"role": "user", "content": prompt})
        return messages

    def _build_capabilities_block(self, tool_names: list[str]) -> str:
        parts = ["\n\n---", "## Available Tools & Sandbox Environment", ""]
        
        for name in tool_names:
            try:
                schema = self.gateway.get_schema(name)
                parts.append(f"- **{name}**: {schema['description']}")
            except KeyError:
                pass
        
        if "python_executor" in tool_names:
            parts.extend([
                "",
                "## Python Sandbox Libraries",
                "numpy, pandas, matplotlib, requests, json, csv, os, re, math,",
                "datetime, collections, itertools, pathlib, io, textwrap, hashlib",
                "",
                "MUST use python_executor to run actual code. Do NOT guess or infer results.",
                "matplotlib can generate charts: plt.savefig('chart.png')",
                "Even with incomplete data, run code on available data instead of claiming 'insufficient data'.",
            ])
        
        if "search_engine" in tool_names:
            parts.extend([
                "",
                "## Search & Information Retrieval (MUST follow)",
                "1. Step 1: Use search_engine to search",
                "2. Step 2: Use webfetch to retrieve full page content from URLs in search results",
                "3. Step 3: If webfetch yields no useful info, retry with different keywords",
                "4. FORBIDDEN: searching without fetching, then claiming 'no information found'",
                "5. After each search round, call webfetch at least once",
            ])
        
        return "\n".join(parts)

    @staticmethod
    def _find_subtask(dag: TaskDAG, subtask_id: str):
        for s in dag.subtasks:
            if s.id == subtask_id:
                return s
        raise KeyError(f"Subtask '{subtask_id}' not found in DAG")

    @staticmethod
    def _gather_context(state: SwarmState, depends_on: list[str]) -> str:
        parts = []
        for dep_id in depends_on:
            if dep_id in state.subtask_results:
                result = state.subtask_results[dep_id]
                if result.output:
                    parts.append(f"[{dep_id}]: {result.output}")
        return "\n\n".join(parts)
