"""Task execution engine — decomposition, orchestration, and WebSocket broadcasting."""

import asyncio
import json
import logging
import os

from agent_swarm import (
    AgentFactory,
    MetaScheduler,
    StateManager,
    SwarmOrchestrator,
    SwarmState,
    TaskDAG,
)
from agent_swarm.budget import BudgetTracker
from agent_swarm.infrastructure.llm_client import LLMClient, BudgetExceededError
from agent_swarm.infrastructure.tool_registry import ToolRegistry
from agent_swarm.trace import trace

logger = logging.getLogger(__name__)


# ── Helper: orchestrator dependencies ──

async def _build_deps(settings: dict):
    """Create the shared tool/LLM/factory/state_manager/budget stack."""
    tools = ToolRegistry()
    llm = LLMClient(base_url=settings["llm_base_url"], api_key=settings["llm_api_key"])
    factory = AgentFactory(available_tools=set(tools.available_tools()), default_model=settings["default_model"])
    state_manager = StateManager(
        checkpoint_dir=os.environ.get("AGENTSWARM_CHECKPOINT_DIR", "./checkpoints"),
    )
    budget = BudgetTracker(token_limit=int(settings.get("budget_token_limit", 200000)))
    llm.set_budget(budget)
    return tools, llm, factory, state_manager, budget


def _build_subtask_info(dag: TaskDAG) -> list[dict]:
    return [
        {"id": s.id, "name": s.agent_config.name, "role": s.agent_config.role,
         "tools": s.agent_config.tools, "depends_on": s.depends_on}
        for s in dag.subtasks
    ]


def _classify_error(e: Exception) -> str:
    msg = str(e).lower()
    if "budget" in msg and ("exceeded" in msg or "exhausted" in msg):
        return "BUDGET_EXCEEDED"
    if "timeout" in msg or "timed out" in msg:
        return "TIMEOUT"
    if "connection" in msg or "refused" in msg or "reset" in msg:
        return "CONNECTION_ERROR"
    if "api key" in msg or "unauthorized" in msg or "auth" in msg:
        return "AUTH_ERROR"
    if "rate" in msg or "quota" in msg or "limit" in msg:
        return "RATE_LIMIT"
    if "parse" in msg or "json" in msg:
        return "PARSE_ERROR"
    return "INTERNAL_ERROR"


# ── Task Execution ──

async def execute_task(
    task_id: str, conv_id: str, query: str, lang: str,
    *, _load_settings, _push_event, storage, manager,
    _cancel_flags,
    WORKSPACE_ROOT,
):
    try:
        settings = await _load_settings()
        ws = WORKSPACE_ROOT / conv_id
        os.environ["AGENTSWARM_WORKSPACE"] = str(ws)

        tools, llm, factory, state_manager, budget = await _build_deps(settings)

        scheduler = MetaScheduler(
            llm=llm, decomposer_model=settings["decomposer_model"],
            available_tools=list(tools.available_tools()),
        )

        async def on_event(event_type: str, data: dict):
            match event_type:
                case "agent_start":
                    trace.record("agent_start", task_id, subtask_id=data["subtask_id"], agent_name=data["agent_name"])
                    _push_event(task_id, {
                        "type": "agent_start", "subtask_id": data["subtask_id"],
                        "agent_name": data["agent_name"], "role": data.get("role", ""),
                    })
                case "agent_done":
                    trace.record("agent_done", task_id, subtask_id=data["subtask_id"], agent_name=data.get("agent_name", ""),
                                 data={"state": data["state"], "iterations": 0, "retries": data.get("retry_count", 0)})
                    await storage.add_agent_result(
                        task_id, data["subtask_id"], data.get("agent_name", ""),
                        data["state"], data.get("output"), data.get("error"), data.get("retry_count", 0),
                    )
                    _push_event(task_id, {
                        "type": "agent_done", "subtask_id": data["subtask_id"],
                        "state": data["state"], "output": data.get("output", ""),
                        "error": data.get("error"), "retry_count": data.get("retry_count", 0),
                    })
                    total = len(dag.subtasks)
                    results = await storage.get_agent_results(task_id)
                    done_count = sum(1 for r in results if r["state"] in ("completed", "failed"))
                    if total > 0:
                        _push_event(task_id, {"type": "progress", "completed": done_count, "total": total})
                case "tool_call":
                    trace.record("tool_call", task_id, agent_name=data["agent_name"], data={"tool": data["tool"]})
                    arg_preview = json.dumps(data.get("args", {}), ensure_ascii=False)[:200]
                    _push_event(task_id, {
                        "type": "tool_call", "agent_name": data["agent_name"],
                        "tool": data["tool"], "args": arg_preview,
                    })

        orchestrator = SwarmOrchestrator(
            tools=tools, llm=llm, factory=factory, state_manager=state_manager,
            max_subtask_retries=2,
            on_event=on_event,
            is_cancelled=lambda: _cancel_flags.get(task_id, False),
        )

        _push_event(task_id, {"type": "status", "msg": "Decomposing task..."})
        _push_event(task_id, {"type": "exec_state", "state": "decomposing"})
        dag: TaskDAG = await scheduler.decompose(query, lang=lang)

        trace.record("dag_generated", task_id, data={"subtasks": len(dag.subtasks), "groups": len(dag.parallel_groups)})
        await storage.update_task(task_id, "running", dag.intent, len(dag.subtasks))
        await storage.update_conversation_title(conv_id, query[:40])

        subtask_info = _build_subtask_info(dag)
        _push_event(task_id, {
            "type": "dag", "intent": dag.intent,
            "subtasks": subtask_info, "parallel_groups": dag.parallel_groups,
        })
        manager.store_dag_snapshot(task_id, {"type": "dag", "task_id": task_id, "intent": dag.intent, "subtasks": subtask_info, "parallel_groups": dag.parallel_groups})
        await storage.store_dag_data(task_id, json.dumps({"intent": dag.intent, "subtasks": subtask_info, "parallel_groups": dag.parallel_groups}))
        _push_event(task_id, {"type": "status", "msg": "Agents starting..."})
        _push_event(task_id, {"type": "exec_state", "state": "streaming"})

        state: SwarmState = await orchestrator.execute(dag)

        results = [{"id": r.subtask_id, "state": r.state.value, "output": r.output, "error": r.error}
                   for r in state.subtask_results.values()]
        summary = orchestrator.aggregator.aggregate(list(state.subtask_results.values()))
        await storage.update_task(task_id, "completed")
        await storage.add_message(conv_id, "assistant", summary)

        _push_event(task_id, {"type": "done", "summary": summary, "results": results})
        budget_summary = budget.summary()
        if budget_summary["total_tokens"] > 0:
            _push_event(task_id, {"type": "status", "msg": f"Budget: {budget_summary['total_tokens']:,}/{budget_summary['token_limit']:,} tokens ({budget_summary['usage_pct']}%), est. ${budget_summary['estimated_cost']:.2f}"})
        trace.record("task_complete", task_id, data={"results": len(results)})
        trace.flush(task_id)

    except BudgetExceededError as e:
        await storage.update_task(task_id, "failed")
        _push_event(task_id, {"type": "error", "msg": str(e), "code": "BUDGET_EXCEEDED"})
    except Exception as e:
        error_code = _classify_error(e)
        logger.exception(f"Task {task_id} failed")
        trace.record("task_error", task_id, data={"error": str(e), "code": error_code})
        trace.flush(task_id)
        await storage.update_task(task_id, "failed")
        _push_event(task_id, {"type": "error", "msg": str(e), "code": error_code})
    finally:
        await asyncio.sleep(30)
        manager.cleanup(task_id)
        _cancel_flags.pop(task_id, None)


async def execute_resume(
    new_task_id: str, original_task_id: str, checkpoint_path: str | None,
    *, _load_settings, _push_event, storage, manager,
    _cancel_flags,
):
    try:
        settings = await _load_settings()
        tools, llm, factory, state_manager, budget = await _build_deps(settings)

        state = await asyncio.to_thread(state_manager.resume, original_task_id, checkpoint_path)
        dag = state.dag

        async def on_event(event_type: str, data: dict):
            match event_type:
                case "agent_start":
                    _push_event(new_task_id, {
                        "type": "agent_start", "subtask_id": data["subtask_id"],
                        "agent_name": data["agent_name"], "role": data.get("role", ""),
                    })
                case "agent_done":
                    await storage.add_agent_result(
                        new_task_id, data["subtask_id"], data.get("agent_name", ""),
                        data["state"], data.get("output"), data.get("error"), data.get("retry_count", 0),
                    )
                    _push_event(new_task_id, {
                        "type": "agent_done", "subtask_id": data["subtask_id"],
                        "state": data["state"], "output": data.get("output", ""),
                        "error": data.get("error"), "retry_count": data.get("retry_count", 0),
                    })
                case "tool_call":
                    arg_preview = json.dumps(data.get("args", {}), ensure_ascii=False)[:200]
                    _push_event(new_task_id, {
                        "type": "tool_call", "agent_name": data["agent_name"],
                        "tool": data["tool"], "args": arg_preview,
                    })

        orchestrator = SwarmOrchestrator(
            tools=tools, llm=llm, factory=factory, state_manager=state_manager,
            max_subtask_retries=2,
            on_event=on_event,
            is_cancelled=lambda: _cancel_flags.get(new_task_id, False),
        )

        subtask_info = _build_subtask_info(dag)
        _push_event(new_task_id, {
            "type": "dag", "intent": dag.intent,
            "subtasks": subtask_info, "parallel_groups": dag.parallel_groups,
        })
        manager.store_dag_snapshot(new_task_id, {"type": "dag", "task_id": new_task_id, "intent": dag.intent, "subtasks": subtask_info, "parallel_groups": dag.parallel_groups})
        _push_event(new_task_id, {"type": "exec_state", "state": "streaming"})

        state = await orchestrator._execute_from_state(state)
        results = [{"id": r.subtask_id, "state": r.state.value, "output": r.output, "error": r.error}
                   for r in state.subtask_results.values()]
        summary = orchestrator.aggregator.aggregate(list(state.subtask_results.values()))
        task = await storage.get_task(original_task_id)
        if task:
            await storage.add_message(task["conversation_id"], "assistant", summary)
        _push_event(new_task_id, {"type": "done", "summary": summary, "results": results})

    except Exception as e:
        _push_event(new_task_id, {"type": "error", "msg": str(e), "code": _classify_error(e)})
    finally:
        await asyncio.sleep(30)
        manager.cleanup(new_task_id)
        _cancel_flags.pop(new_task_id, None)


async def execute_rerun(
    task_id: str, conv_id: str, query: str, subtasks: list, parallel_groups: list,
    *, _load_settings, _push_event, storage, manager,
    _cancel_flags,
):
    from agent_swarm.models import AgentConfig, Subtask, TaskDAG

    try:
        settings = await _load_settings()
        tools, llm, factory, state_manager, budget = await _build_deps(settings)

        subtask_models = []
        all_ids = {s["id"] for s in subtasks}
        for s in subtasks:
            cfg = AgentConfig(
                name=s.get("name", s["id"]), role=s.get("role", "rerun"),
                system_prompt=s.get("system_prompt", "Rerun agent"), tools=s.get("tools", []),
            )
            deps = [d for d in s.get("depends_on", []) if d in all_ids]
            subtask_models.append(Subtask(id=s["id"], agent_config=cfg, prompt=s.get("prompt", ""), depends_on=deps))

        dag = TaskDAG(
            task_id=task_id, original_query=query, intent="rerun",
            subtasks=subtask_models, parallel_groups=[
                [tid for tid in g if tid in all_ids] for g in parallel_groups
            ],
        )
        dag.parallel_groups = [g for g in dag.parallel_groups if g]

        orchestrator = SwarmOrchestrator(
            tools=tools, llm=llm, factory=factory, state_manager=state_manager,
            max_subtask_retries=1,
        )

        subtask_info = _build_subtask_info(dag)
        _push_event(task_id, {
            "type": "dag", "intent": "rerun",
            "subtasks": subtask_info, "parallel_groups": dag.parallel_groups,
        })
        manager.store_dag_snapshot(task_id, {"type": "dag", "task_id": task_id, "intent": "rerun", "subtasks": subtask_info, "parallel_groups": dag.parallel_groups})

        state = await orchestrator.execute(dag)
        results = [{"id": r.subtask_id, "state": r.state.value, "output": r.output, "error": r.error}
                   for r in state.subtask_results.values()]
        summary = orchestrator.aggregator.aggregate(list(state.subtask_results.values()))
        await storage.add_message(conv_id, "assistant", summary)
        _push_event(task_id, {"type": "done", "summary": summary, "results": results})

    except Exception as e:
        _push_event(task_id, {"type": "error", "msg": str(e), "code": _classify_error(e)})
    finally:
        await asyncio.sleep(30)
        manager.cleanup(task_id)
        _cancel_flags.pop(task_id, None)
