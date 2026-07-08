"""Swarm Orchestrator — parallel execution engine dispatching agents by DAG parallel_groups."""

import asyncio
import json
import logging
from collections.abc import Callable
from typing import Any

from agent_swarm.agent_factory import Agent, AgentFactory
from agent_swarm.context import get_context
from agent_swarm.data_buffer import DataBuffer, KeyContract
from agent_swarm.infrastructure.llm_client import LLMClient
from agent_swarm.infrastructure.tool_registry import ToolRegistry
from agent_swarm.judge import (
    JudgeEvaluation,
    JudgeVerdict,
    StallDetector,
    judge_output,
    judge_output_heuristic,
)
from agent_swarm.meta_scheduler import MetaScheduler
from agent_swarm.models import AgentConfig, ApprovalRequest, Subtask, SubtaskResult, SubtaskState, SwarmState, TaskDAG
from agent_swarm.state_manager import StateManager

logger = logging.getLogger(__name__)


class ResultAggregator:
    """汇总所有子任务结果，生成最终输出。"""

    def aggregate(self, results: list[SubtaskResult]) -> str:
        completed = sum(1 for r in results if r.state == SubtaskState.COMPLETED)
        failed = sum(1 for r in results if r.state == SubtaskState.FAILED)
        summary = f"# Result Summary\n\n{completed}/{len(results)} subtasks completed"
        if failed:
            summary += f", {failed} failed"

        outputs = [r.output for r in results if r.state == SubtaskState.COMPLETED and r.output]
        if outputs:
            summary += "\n\n" + "\n\n".join(outputs)

        return summary


class SwarmOrchestrator:
    MAX_SEARCH_ROUNDS = 4
    ENABLE_LLM_JUDGE = True       # set False to use heuristic-only judge
    JUDGE_MODEL = "qwen3:3b"      # small model for quality evaluation
    MAX_QUALITY_RETRIES = 2       # retries triggered by Judge within a single run

    def __init__(
        self,
        tools: ToolRegistry,
        factory: AgentFactory,
        state_manager: StateManager,
        llm: LLMClient,
        max_subtask_retries: int = 2,
        on_event: Callable[[str, dict[str, Any]], None] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
        wait_for_approval: Callable[[], Any] | None = None,
    ):
        self.tools = tools
        self.factory = factory
        self.state_manager = state_manager
        self.llm = llm
        self.max_subtask_retries = max_subtask_retries
        self.aggregator = ResultAggregator()
        self.on_event = on_event
        self.is_cancelled = is_cancelled or (lambda: False)
        self.wait_for_approval = wait_for_approval

    def _check_cancelled(self) -> bool:
        return self.is_cancelled()

    def _emit(self, event_type: str, **data):
        if self.on_event:
            try:
                result = self.on_event(event_type, data)
                if asyncio.iscoroutine(result):
                    task = asyncio.create_task(result)
                    task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)
            except Exception:
                logger.exception("Event callback failed")

    # ── LLM / Tool helpers ──

    async def _call_llm(self, model: str, messages: list[dict], tools: list[dict] | None = None,
                   temperature: float = 0.3):
        return await self.llm.chat(model, messages, tools, temperature)

    async def _call_tool(self, name: str, **kwargs):
        return await self.tools.call(name, **kwargs)

    def _get_tool_schema(self, name: str) -> dict:
        return self.tools.get_schema(name)

    async def execute(self, dag: TaskDAG) -> SwarmState:
        state = self.state_manager.initialize(dag.task_id, dag)
        return await self._execute_from_state(state)

    async def resume(self, task_id: str) -> SwarmState:
        state = self.state_manager.resume(task_id)
        return await self._execute_from_state(state)

    async def _execute_from_state(self, state: SwarmState) -> SwarmState:
        dag = state.dag
        data_buffer = DataBuffer()
        consecutive_group_failures = 0
        MAX_GROUP_FAILURES_BEFORE_REDECOMPOSE = 2

        while state.current_group < len(dag.parallel_groups):
            if self._check_cancelled():
                logger.info(f"Task {dag.task_id} cancelled during execution")
                for sid, r in state.subtask_results.items():
                    if r.state == SubtaskState.RUNNING:
                        r.state = SubtaskState.FAILED
                        r.error = "Task cancelled by user"
                break

            group = dag.parallel_groups[state.current_group]
            logger.info(
                f"Executing group {state.current_group + 1}/{len(dag.parallel_groups)}: {group}"
            )

            pending_ids = list(group)
            results: dict[str, SubtaskResult] = {}

            for attempt in range(self.max_subtask_retries + 1):
                if not pending_ids:
                    break

                if attempt > 0:
                    logger.info(f"  Retry #{attempt}: {pending_ids}")

                batch = []
                for subtask_id in pending_ids:
                    subtask = self._find_subtask(dag, subtask_id)
                    agent = self.factory.create(subtask.agent_config)
                    # Build context from upstream results via DataBuffer
                    upstream_context = self._gather_context(state, subtask.depends_on)
                    # Also build DataBuffer context for agents that declare reads
                    contract = KeyContract(
                        reads=subtask.depends_on,
                        writes=[subtask_id],
                    )
                    buffer_context = data_buffer.build_context(contract) if subtask.depends_on else ""
                    context = upstream_context + ("\n\n## Upstream Data\n" + buffer_context if buffer_context else "")
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
                        result.retry_history = old.retry_history + [f"Attempt {attempt}: {result.state.value}"]
                        if result.state == SubtaskState.FAILED and not result.error and old.error:
                            result.error = old.error
                    results[sid] = result

                pending_ids = [
                    sid for sid, r in results.items()
                    if r.state == SubtaskState.FAILED and attempt < self.max_subtask_retries
                ]
                if pending_ids:
                    for sid in pending_ids:
                        logger.warning(f"  [{sid}] FAILED → will retry")

            for sid, result in list(results.items()):
                if result.state == SubtaskState.FAILED:
                    subtask = self._find_subtask(dag, sid)
                    new_subtask = await self._replan_subtask(dag, subtask, result)
                    if new_subtask:
                        logger.info(f"  [{sid}] Re-planning with new approach")
                        for i, s in enumerate(dag.subtasks):
                            if s.id == sid:
                                dag.subtasks[i] = new_subtask
                                break
                        agent = self.factory.create(new_subtask.agent_config)
                        context = self._gather_context(state, new_subtask.depends_on)
                        new_result = await self._run_single_agent(sid, agent, new_subtask.prompt, context)
                        new_result.retry_history = result.retry_history + ["Re-planned: new approach generated"]
                        results[sid] = new_result

            for result in results.values():
                state = self.state_manager.update_subtask(state, result)
                # Write completed results into DataBuffer for downstream agents
                if result.state == SubtaskState.COMPLETED and result.output:
                    data_buffer.ingest_subtask_output(
                        subtask_id=result.subtask_id,
                        output=result.output,
                    )

            # ── Self-healing: detect group-level failure and trigger redecomposition ──
            group_failed_count = sum(1 for r in results.values() if r.state == SubtaskState.FAILED)
            if group_failed_count > 0:
                consecutive_group_failures += 1
            else:
                consecutive_group_failures = 0

            if consecutive_group_failures >= MAX_GROUP_FAILURES_BEFORE_REDECOMPOSE and state.current_group + 1 < len(dag.parallel_groups):
                logger.warning(
                    f"  {consecutive_group_failures} consecutive groups had failures — "
                    f"triggering full DAG redecomposition"
                )
                self._emit("tool_call", agent_name="orchestrator", tool="redecompose",
                          args={"reason": f"{consecutive_group_failures} consecutive group failures"})
                new_dag = await self._redecompose_dag(
                    dag=dag,
                    failed_results={sid: r for sid, r in results.items() if r.state == SubtaskState.FAILED},
                    data_buffer=data_buffer,
                )
                if new_dag:
                    logger.info(f"  Redecomposed DAG: {len(new_dag.subtasks)} subtasks, {len(new_dag.parallel_groups)} groups")
                    # Replace remaining groups with redecomposed plan
                    dag.subtasks = [s for s in dag.subtasks if s.id in results and results[s.id].state != SubtaskState.FAILED] + [
                        s for s in new_dag.subtasks
                    ]
                    # Rebuild parallel_groups: keep completed groups, replace remaining with new
                    completed_groups = dag.parallel_groups[:state.current_group + 1]
                    new_groups = new_dag.parallel_groups
                    dag.parallel_groups = completed_groups + new_groups
                    consecutive_group_failures = 0

            self.state_manager.checkpoint(state)
            state = self.state_manager.advance_group(state)

        self.state_manager.cleanup(dag.task_id, keep_latest=3)
        return state

    # ─── Quality Gate ───

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

    async def _replan_subtask(self, dag: TaskDAG, subtask: Subtask, failed_result: SubtaskResult) -> Subtask | None:
        """Generate a replacement subtask when the original fails after max retries."""
        try:
            replan_prompt = (
                f"Original task: {dag.original_query}\n"
                f"Failed subtask: {subtask.prompt}\n"
                f"Error: {failed_result.error or 'no output produced'}\n"
                f"Retry history: {failed_result.retry_history}\n\n"
                "The agent above failed. Generate a NEW approach with a different strategy, tool set, or angle. "
                "Output JSON: {\"name\": \"agent_name\", \"role\": \"role\", "
                "\"system_prompt\": \"...\", \"tools\": [\"tool1\"], \"prompt\": \"new task prompt\"}"
            )
            msg = await self._call_llm(
                self.factory.default_model,
                [{"role": "user", "content": replan_prompt}],
                temperature=0.5,
            )
            raw = (msg.content or "").strip()
            parsed = MetaScheduler._parse_json_output(raw)
            return Subtask(
                id=subtask.id,
                agent_config=AgentConfig(
                    name=parsed.get("name", f"replan_{subtask.id}"),
                    role=parsed.get("role", subtask.agent_config.role),
                    system_prompt=parsed.get("system_prompt", subtask.agent_config.system_prompt),
                    tools=parsed.get("tools", subtask.agent_config.tools),
                    max_iterations=subtask.agent_config.max_iterations,
                ),
                prompt=parsed.get("prompt", subtask.prompt),
                depends_on=subtask.depends_on,
            )
        except Exception:
            return None

    async def _redecompose_dag(
        self,
        dag: TaskDAG,
        failed_results: dict[str, SubtaskResult],
        data_buffer: DataBuffer,
    ) -> TaskDAG | None:
        """Re-decompose the remaining work when multiple groups consecutively fail.

        Sends the original query + failure context back to the decomposer
        to generate a fresh DAG for the unfinished portions of the task.
        """
        try:
            failure_context = "\n".join(
                f"  [{sid}] {r.error or 'no output'} (retries: {r.retry_count})"
                for sid, r in failed_results.items()
            )
            redecompose_prompt = (
                f"## Original Task\n{dag.original_query}\n\n"
                f"## Completed So Far\n"
                + ("\n".join(f"- {k}: {v.get('source', '')[:200]}" for k, v in data_buffer.snapshot()["keys"].items()))
                + f"\n\n## Failed Subtasks (need new approach)\n{failure_context}\n\n"
                "Re-decompose the REMAINING work into a new set of subtasks. "
                "Learn from the failures: use different agent strategies, different tools, "
                "or break the work into smaller pieces. "
                "Output the standard decomposition JSON with 'subtasks' and 'parallel_groups'."
            )
            msg = await self._call_llm(
                self.factory.default_model,
                [
                    {"role": "system", "content": "You are a task decomposition expert. Redesign the failed subtasks with new approaches."},
                    {"role": "user", "content": redecompose_prompt},
                ],
                temperature=0.5,
            )
            raw = (msg.content or "").strip()
            parsed = MetaScheduler._parse_json_output(raw)

            import uuid as _uuid
            new_task_id = f"redecompose_{dag.task_id}_{_uuid.uuid4().hex[:6]}"
            new_dag = TaskDAG(
                task_id=new_task_id,
                original_query=f"[Redecomposed from {dag.task_id}] {dag.original_query}",
                intent=dag.intent,
                subtasks=[Subtask.model_validate(s) for s in parsed["subtasks"]],
                parallel_groups=parsed["parallel_groups"],
            )
            logger.info(f"Redecomposed → {len(new_dag.subtasks)} subtasks, {len(new_dag.parallel_groups)} groups")
            return new_dag
        except Exception as e:
            logger.warning(f"Redecomposition failed: {e}")
            return None

    async def _run_single_agent(
        self, subtask_id: str, agent: Agent, prompt: str, context: str = ""
    ) -> SubtaskResult:
        self._emit("agent_start", subtask_id=subtask_id, agent_name=agent.name, role=agent.role)

        messages = self._build_messages(agent, prompt, context)
        tools = self._build_tools_schema(agent)
        has_search_tool = "search_engine" in agent.tool_names()

        stall_detector = StallDetector()
        iteration = 0
        final_output = ""
        search_count = 0
        active_tools = tools
        quality_retries = 0
        judge_feedback = ""

        while iteration < agent.max_iterations:
            if self._check_cancelled():
                return SubtaskResult(
                    subtask_id=subtask_id,
                    state=SubtaskState.FAILED,
                    error="Task cancelled by user",
                    iterations_used=iteration,
                )

            iteration += 1

            # ── Doom-loop check ──
            doom_msg = stall_detector.check_doom_loop()
            if doom_msg:
                logger.warning(f"  [{agent.name}] {doom_msg}")
                self._emit("tool_call", agent_name=agent.name, tool="judge:doom_loop", args={"message": doom_msg})

            if has_search_tool and search_count >= self.MAX_SEARCH_ROUNDS:
                messages.append({
                    "role": "system",
                    "content": (
                        f"You have already searched {search_count} times. "
                        "STOP searching. Produce your final output NOW with the best information you have."
                    ),
                })
                active_tools = []
                has_search_tool = False

            # ── Inject judge feedback from previous quality retry ──
            if judge_feedback:
                messages.append({
                    "role": "system",
                    "content": f"[Quality Feedback] {judge_feedback}\n\nPlease improve your output and try again.",
                })
                judge_feedback = ""  # only apply once per retry

            try:
                msg = await self._call_llm(
                    model=agent.model,
                    messages=messages,
                    tools=active_tools,
                )

                # ── HITL: check for tool calls needing approval ──
                if msg.tool_calls and self.wait_for_approval:
                    tool_calls_to_approve = []
                    tool_calls_approved = []
                    for tc in msg.tool_calls:
                        if tc.function.name in ("browser", "file_writer", "shell"):
                            tool_calls_to_approve.append(tc)
                        else:
                            tool_calls_approved.append(tc)

                    if tool_calls_to_approve:
                        # Emit approval for the first risky tool call; only execute that ONE
                        # after approval, not all risky calls — user only approved one action
                        tc = tool_calls_to_approve[0]
                        try:
                            tc_args = json.loads(tc.function.arguments)
                        except Exception:
                            tc_args = {}
                        self._emit("approval_request",
                                  subtask_id=subtask_id,
                                  agent_name=agent.name,
                                  action=f"{tc.function.name}({json.dumps(tc_args, ensure_ascii=False)[:200]})",
                                  reasoning=f"Agent '{agent.name}' wants to execute {tc.function.name}",
                                  risk_level="high" if tc.function.name == "shell" else "medium")
                        logger.info(f"  [{agent.name}] Awaiting user approval for {tc.function.name}")
                        decision = await self.wait_for_approval()
                        if not decision or not decision.get("approved"):
                            feedback = (decision or {}).get("feedback", "User rejected the action")
                            messages.append({
                                "role": "system",
                                "content": f"[User Decision] Action REJECTED: {feedback}. Adjust your approach.",
                            })
                            continue  # go to next iteration with feedback
                        # Approved: add approval note, then execute only the approved call
                        fb = decision.get("feedback", "")
                        if fb:
                            messages.append({
                                "role": "system",
                                "content": f"[User Decision] Approved with note: {fb}. Proceed.",
                            })
                        # Merge: approved calls back with previously safe calls
                        msg.tool_calls = tool_calls_approved + [tc]

                if msg.tool_calls:
                    messages = await self._handle_tool_calls(agent, msg.tool_calls, messages)
                    search_count += sum(
                        1 for tc in (msg.tool_calls or [])
                        if tc.function.name == "search_engine"
                    )
                    # Record actions for doom-loop detection
                    for tc in (msg.tool_calls or []):
                        stall_detector.record_action(tc.function.name)
                else:
                    final_output = msg.content or ""
                    stall_detector.record_output(final_output)

                    # ── Judge quality evaluation ──
                    evaluation = await self._evaluate_quality(
                        task_prompt=prompt,
                        output=final_output,
                        agent_role=agent.role,
                        retry_count=quality_retries,
                        stall_detector=stall_detector,
                    )

                    if evaluation.verdict == JudgeVerdict.REJECT:
                        logger.warning(f"  [{agent.name}] Judge REJECT (score={evaluation.score:.2f}): {evaluation.feedback[:100]}")
                        result = SubtaskResult(
                            subtask_id=subtask_id,
                            state=SubtaskState.FAILED,
                            output=final_output,
                            error=f"Judge rejected (score={evaluation.score:.2f}): {evaluation.feedback[:300]}",
                            iterations_used=iteration,
                        )
                        self._emit("agent_done", subtask_id=subtask_id, state=result.state.value,
                                  output=result.output, error=result.error, retry_count=result.retry_count)
                        return result

                    if evaluation.verdict == JudgeVerdict.RETRY and quality_retries < self.MAX_QUALITY_RETRIES:
                        quality_retries += 1
                        judge_feedback = evaluation.feedback
                        logger.info(
                            f"  [{agent.name}] Judge RETRY #{quality_retries} "
                            f"(score={evaluation.score:.2f}): {evaluation.feedback[:100]}"
                        )
                        self._emit("tool_call", agent_name=agent.name,
                                  tool="judge:retry",
                                  args={"score": evaluation.score, "feedback": evaluation.feedback[:200]})
                        # Continue while loop — will re-prompt with judge_feedback
                        continue

                    # ACCEPT or retries exhausted
                    messages.append({"role": "assistant", "content": final_output})
                    break

            except Exception as e:
                logger.error(f"Agent '{agent.name}' error at iteration {iteration}: {e}")
                result = SubtaskResult(
                    subtask_id=subtask_id,
                    state=SubtaskState.FAILED,
                    error=str(e),
                    iterations_used=iteration,
                )
                self._emit("agent_done", subtask_id=subtask_id, state=result.state.value,
                          output=result.output, error=result.error, retry_count=result.retry_count)
                return result

        if not final_output and messages:
            for m in reversed(messages):
                if m["role"] == "assistant" and m.get("content"):
                    final_output = m["content"]
                    break

        exhausted = iteration >= agent.max_iterations and not final_output
        result = SubtaskResult(
            subtask_id=subtask_id,
            state=SubtaskState.COMPLETED if final_output else SubtaskState.FAILED,
            output=final_output if final_output else None,
            error=(
                f"Agent exhausted {agent.max_iterations} iterations without producing output"
                if exhausted else None
            ),
            iterations_used=iteration,
        )
        self._emit("agent_done", subtask_id=subtask_id, state=result.state.value,
                  output=result.output, error=result.error, retry_count=result.retry_count)
        return result

    async def _evaluate_quality(
        self,
        task_prompt: str,
        output: str,
        agent_role: str,
        retry_count: int,
        stall_detector: StallDetector | None,
    ) -> JudgeEvaluation:
        """Run judge evaluation: heuristic first, then LLM if enabled."""
        # Always run heuristic first (fast, free)
        heuristic = judge_output_heuristic(
            output=output,
            task_prompt=task_prompt,
            retry_count=retry_count,
            stall_detector=stall_detector,
        )
        # If heuristic finds doom loop or retry limit, skip LLM — it's definitive
        if heuristic.verdict == JudgeVerdict.REJECT:
            return heuristic

        # If LLM judge is disabled, use heuristic result
        if not self.ENABLE_LLM_JUDGE:
            return heuristic

        # LLM judge for deeper evaluation
        try:
            llm_eval = await judge_output(
                llm_call=self._call_llm,
                task_prompt=task_prompt,
                output=output,
                agent_role=agent_role,
                judge_model=self.JUDGE_MODEL,
            )
            # Merge: take the stricter verdict
            if llm_eval.verdict == JudgeVerdict.REJECT or heuristic.verdict == JudgeVerdict.REJECT:
                verdict = JudgeVerdict.REJECT
                score = min(llm_eval.score, heuristic.score)
                feedback = " | ".join(filter(None, [llm_eval.feedback, heuristic.feedback]))
                concerns = llm_eval.concerns + heuristic.concerns
            elif llm_eval.verdict == JudgeVerdict.RETRY or heuristic.verdict == JudgeVerdict.RETRY:
                verdict = JudgeVerdict.RETRY
                score = min(llm_eval.score, heuristic.score)
                feedback = " | ".join(filter(None, [llm_eval.feedback, heuristic.feedback]))
                concerns = llm_eval.concerns + heuristic.concerns
            else:
                verdict = JudgeVerdict.ACCEPT
                score = max(llm_eval.score, heuristic.score)
                feedback = ""
                concerns = []
            return JudgeEvaluation(verdict=verdict, score=score, feedback=feedback, concerns=concerns)
        except Exception as e:
            logger.warning(f"LLM judge failed, falling back to heuristic: {e}")
            return heuristic

    async def _handle_tool_calls(self, agent: Agent, tool_calls, messages: list) -> list:
        # Collect all tool_calls into one assistant message (OpenAI API expects this)
        assistant_tool_calls = []
        for tool_call in tool_calls:
            func_name = tool_call.function.name
            assistant_tool_calls.append({
                "id": tool_call.id,
                "type": "function",
                "function": {
                    "name": func_name,
                    "arguments": tool_call.function.arguments,
                },
            })

        messages.append({
            "role": "assistant",
            "content": None,
            "tool_calls": assistant_tool_calls,
        })

        for tool_call in tool_calls:
            func_name = tool_call.function.name
            try:
                func_args = json.loads(tool_call.function.arguments)
            except Exception:
                func_args = {}

            self._emit("tool_call", agent_name=agent.name, tool=func_name, args=func_args)
            logger.info(f"  Agent '{agent.name}' calls tool: {func_name}")

            try:
                tool_result = await self._call_tool(func_name, **func_args)
                tool_result_str = str(tool_result)
            except Exception as e:
                tool_result_str = f"Tool call failed: {e}"

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": tool_result_str[:8000],
            })

        return messages

    # ─── Helper methods ───

    def _build_tools_schema(self, agent: Agent) -> list[dict]:
        tools = []
        for tool_name in agent.tool_names():
            try:
                schema = self._get_tool_schema(tool_name)
                tool_def = self.tools._tools.get(tool_name)
                required = tool_def.required_params if (tool_def and tool_def.required_params is not None) else list(schema["parameters"].keys())
                tools.append({
                    "type": "function",
                    "function": {
                        "name": schema["name"],
                        "description": schema["description"],
                        "parameters": {
                            "type": "object",
                            "properties": schema["parameters"],
                            "required": required,
                        },
                    },
                })
            except KeyError:
                logger.warning(f"Tool '{tool_name}' not found, skipping")
        return tools

    def _build_messages(self, agent: Agent, prompt: str, context: str) -> list[dict]:
        ctx_mgr = get_context()
        upstream_results = []
        if context:
            for block in context.split("\n\n"):
                if block.strip():
                    # Extract subtask_id safely from the block prefix "[t1]: ..."
                    subtask_id = "unknown"
                    if block.startswith("[") and "]: " in block:
                        end_bracket = block.index("]")
                        subtask_id = block[1:end_bracket]
                    upstream_results.append(SubtaskResult(
                        subtask_id=subtask_id,
                        output=block, state=SubtaskState.COMPLETED
                    ))
        smart_context = ctx_mgr.build(agent.role, prompt, upstream_results)

        capabilities = self._build_capabilities_block(agent.tool_names())
        full_system = agent.system_prompt + capabilities + "\n\n## Context\n" + smart_context if smart_context else agent.system_prompt + capabilities

        messages = [{"role": "system", "content": full_system}]
        messages.append({"role": "user", "content": prompt})
        return messages

    def _build_capabilities_block(self, tool_names: list[str]) -> str:
        parts = ["\n\n---", "## Available Tools & Sandbox Environment", ""]

        for name in tool_names:
            try:
                schema = self._get_tool_schema(name)
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
                "## Search & Information Retrieval (MUST follow strictly)",
                "1. Use search_engine to search — this gives you URLs and short snippets only",
                "2. IMMEDIATELY call webfetch on the top 2-3 URLs to read full page content",
                "   The snippets from search are NOT enough. You MUST read the actual pages.",
                "3. Extract specific data, numbers, and facts from the pages you fetch",
                "4. If pages have no useful data, search with different keywords and try again",
                "5. After 4 rounds, STOP and output best available information",
            ])

        return "\n".join(parts)

    @staticmethod
    def _find_subtask(dag: TaskDAG, subtask_id: str) -> Subtask:
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
