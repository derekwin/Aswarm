"""Swarm Orchestrator - 并行执行引擎，按 DAG 中的 parallel_groups 调度 Agent 执行。"""

import asyncio
import json
import logging
from openai import AsyncOpenAI

from agent_swarm.models import (
    TaskDAG, SwarmState, SubtaskResult, SubtaskState, AgentConfig
)
from agent_swarm.mcp_gateway import MCPGateway
from agent_swarm.agent_factory import AgentFactory, Agent
from agent_swarm.state_manager import StateManager

logger = logging.getLogger(__name__)


class ResultAggregator:
    """汇总所有子任务结果，生成最终输出。"""

    def aggregate(self, results: list[SubtaskResult]) -> str:
        """将子任务结果汇总为自然语言摘要。"""
        parts = []

        for r in results:
            header = f"## Subtask: {r.subtask_id} [{r.state.value}]"
            parts.append(header)

            if r.state == SubtaskState.COMPLETED and r.output:
                parts.append(r.output)
            elif r.state == SubtaskState.FAILED:
                parts.append(f"**FAILED**: {r.error}")

            parts.append("")  # blank line separator

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

    用法:
        orch = SwarmOrchestrator(gateway, factory, state_manager,
                                  llm_base_url="...", llm_api_key="...")
        state = await orch.execute(dag)
    """

    def __init__(
        self,
        gateway: MCPGateway,
        factory: AgentFactory,
        state_manager: StateManager,
        llm_base_url: str,
        llm_api_key: str,
    ):
        self.gateway = gateway
        self.factory = factory
        self.state_manager = state_manager
        self.llm = AsyncOpenAI(base_url=llm_base_url, api_key=llm_api_key)
        self.aggregator = ResultAggregator()

    async def execute(self, dag: TaskDAG) -> SwarmState:
        """执行完整的 DAG。"""
        state = self.state_manager.initialize(dag.task_id, dag)

        while state.current_group < len(dag.parallel_groups):
            group = dag.parallel_groups[state.current_group]
            logger.info(
                f"Executing group {state.current_group + 1}/{len(dag.parallel_groups)}: {group}"
            )

            # 并行执行当前组的所有 Agent
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

    async def resume(self, task_id: str) -> SwarmState:
        """从 checkpoint 恢复并继续执行。"""
        state = self.state_manager.resume(task_id)
        dag = state.dag

        while state.current_group < len(dag.parallel_groups):
            group = dag.parallel_groups[state.current_group]
            logger.info(
                f"Resuming group {state.current_group + 1}/{len(dag.parallel_groups)}: {group}"
            )

            tasks = []
            for subtask_id in group:
                subtask = self._find_subtask(dag, subtask_id)
                agent = self.factory.create(subtask.agent_config)
                context = self._gather_context(state, subtask.depends_on)
                tasks.append(self._run_single_agent(subtask_id, agent, subtask.prompt, context))

            results = await asyncio.gather(*tasks)

            for result in results:
                state = self.state_manager.update_subtask(state, result)

            self.state_manager.checkpoint(state)
            state = self.state_manager.advance_group(state)

        self.state_manager.cleanup(task_id, keep_latest=3)
        return state

    async def _run_single_agent(
        self, subtask_id: str, agent: Agent, prompt: str, context: str = ""
    ) -> SubtaskResult:
        """运行单个 Agent 完成子任务。"""
        messages = [{"role": "system", "content": agent.system_prompt}]

        if context:
            messages.append({
                "role": "system",
                "content": f"上游Agent的输出（参考上下文）:\n{context}",
            })

        messages.append({"role": "user", "content": prompt})

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

        iteration = 0
        final_output = ""

        while iteration < agent.max_iterations:
            iteration += 1

            try:
                if tools:
                    response = await self.llm.chat.completions.create(
                        model=agent.model,
                        messages=messages,
                        tools=tools,
                        tool_choice="auto",
                        temperature=0.3,
                    )
                else:
                    response = await self.llm.chat.completions.create(
                        model=agent.model,
                        messages=messages,
                        temperature=0.3,
                    )

                choice = response.choices[0]
                msg = choice.message

                if msg.tool_calls:
                    for tool_call in msg.tool_calls:
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
                            "tool_calls": [
                                {
                                    "id": tool_call.id,
                                    "type": "function",
                                    "function": {
                                        "name": func_name,
                                        "arguments": tool_call.function.arguments,
                                    },
                                }
                            ],
                        })
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": tool_result_str[:8000],
                        })
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

    @staticmethod
    def _find_subtask(dag: TaskDAG, subtask_id: str):
        """在 DAG 中查找子任务。"""
        for s in dag.subtasks:
            if s.id == subtask_id:
                return s
        raise KeyError(f"Subtask '{subtask_id}' not found in DAG")

    @staticmethod
    def _gather_context(state: SwarmState, depends_on: list[str]) -> str:
        """收集依赖子任务的输出作为上下文。"""
        parts = []
        for dep_id in depends_on:
            if dep_id in state.subtask_results:
                result = state.subtask_results[dep_id]
                if result.output:
                    parts.append(f"[{dep_id}]: {result.output}")
        return "\n\n".join(parts)
