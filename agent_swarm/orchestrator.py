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
    ):
        self.gateway = gateway
        self.factory = factory
        self.state_manager = state_manager
        self.llm = AsyncOpenAI(base_url=llm_base_url, api_key=llm_api_key)
        self.aggregator = ResultAggregator()
        self.max_retries = max_retries

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

            tasks = []
            for subtask_id in group:
                subtask = self._find_subtask(dag, subtask_id)
                agent = self.factory.create(subtask.agent_config)
                context = self._gather_context(state, subtask.depends_on)
                tasks.append(self._run_single_agent(subtask_id, agent, subtask.prompt, context))

            results: list[SubtaskResult] = await asyncio.gather(*tasks)

            for result in results:
                state = self.state_manager.update_subtask(state, result)

            self.state_manager.checkpoint(state)
            state = self.state_manager.advance_group(state)

        self.state_manager.cleanup(dag.task_id, keep_latest=3)
        return state

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

        return SubtaskResult(
            subtask_id=subtask_id,
            state=SubtaskState.COMPLETED if final_output else SubtaskState.FAILED,
            output=final_output or "No output generated",
            iterations_used=iteration,
        )

    async def _call_llm_with_retry(self, model: str, messages: list, tools: list):
        last_error = None
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

            except Exception as e:
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
                "content": f"上游Agent的输出（参考上下文）:\n{context}",
            })
        messages.append({"role": "user", "content": prompt})
        return messages

    def _build_capabilities_block(self, tool_names: list[str]) -> str:
        """构建工具能力注入块（类似 Claude Code 的工具清单）。"""
        parts = ["\n\n---", "## 可用工具与沙箱环境", ""]
        
        for name in tool_names:
            try:
                schema = self.gateway.get_schema(name)
                parts.append(f"- **{name}**: {schema['description']}")
            except KeyError:
                pass
        
        if "python_executor" in tool_names:
            parts.extend([
                "",
                "## Python 沙箱可用库",
                "numpy, pandas, matplotlib, requests, json, csv, os, re, math,",
                "datetime, collections, itertools, pathlib, io, textwrap, hashlib",
                "",
                "**重要**: matplotlib 可以生成图表，使用 `plt.savefig()` 保存图片文件。",
                "数据分析和计算任务必须用 python_executor 执行，不要「推断」或「假设」结果。",
            ])
        
        if "search_engine" in tool_names:
            parts.extend([
                "",
                "## 搜索与信息获取策略",
                "1. 先用 search_engine 搜索关键词，获取 URL 列表",
                "2. 对有价值的页面用 webfetch 获取全文阅读",
                "3. 如果搜索结果不满意，换角度/换关键词重新搜索，不要轻易放弃",
                "4. 至少尝试 2-3 轮搜索后才下结论",
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
