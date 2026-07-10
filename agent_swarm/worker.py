"""AgentSwarm Python Worker — thin FastAPI wrapper for Next.js to call.

Provides decomposition, execution, cancellation, and SSE event streaming.
Designed to run on localhost:8001 as a backend service for Next.js.
"""

import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from agent_swarm import (
    AgentFactory,
    MetaScheduler,
    StateManager,
    SwarmOrchestrator,
)
from agent_swarm.budget import BudgetTracker
from agent_swarm.infrastructure.llm_client import LLMClient
from agent_swarm.infrastructure.tool_registry import ToolRegistry
from agent_swarm.trace import trace

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── App ──

@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield

app = FastAPI(title="AgentSwarm Worker", lifespan=lifespan, docs_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── State ──

_cancel_flags: dict[str, bool] = {}
_event_queues: dict[str, asyncio.Queue] = {}

# ── Settings ──

_default_settings = {
    "llm_base_url": os.environ.get("AGENTSWARM_LLM_BASE_URL", "http://localhost:11434/v1"),
    "llm_api_key": os.environ.get("AGENTSWARM_LLM_API_KEY", "ollama"),
    "decomposer_model": os.environ.get("AGENTSWARM_DECOMPOSER_MODEL", "qwen3:8b"),
    "default_model": os.environ.get("AGENTSWARM_DEFAULT_MODEL", "qwen3:8b"),
    "budget_token_limit": int(os.environ.get("AGENTSWARM_BUDGET_TOKENS", "200000")),
}


async def _load_settings():
    """Load settings: DB overrides env defaults."""
    settings = dict(_default_settings)
    try:
        import aiosqlite
        db_path = os.path.join(os.environ.get("AGENTSWARM_DATA_DIR", "data"), "agentswarm.db")
        if os.path.exists(db_path):
            async with aiosqlite.connect(db_path) as db:
                cursor = await db.execute("SELECT key, value FROM settings")
                rows = await cursor.fetchall()
                for key, value in rows:
                    if key in settings and value is not None:
                        settings[key] = value
    except Exception:
        pass  # DB not available, use defaults
    return settings


# ── Helpers ──

def _push_event(task_id: str, event: dict):
    """Push event to the task's SSE queue."""
    q = _event_queues.get(task_id)
    if q:
        event["task_id"] = task_id
        q.put_nowait(event)


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
    return "INTERNAL_ERROR"


# ── Decomposition ──

@app.post("/decompose")
async def decompose(query: str = Query(...), lang: str = Query(default="en")):
    settings = await _load_settings()
    llm = LLMClient(base_url=settings["llm_base_url"], api_key=settings["llm_api_key"])
    tools = ToolRegistry()

    scheduler = MetaScheduler(
        llm=llm,
        decomposer_model=settings["decomposer_model"],
        available_tools=list(tools.available_tools()),
    )

    dag = await scheduler.decompose(query, lang=lang)

    subtask_info = [
        {"id": s.id, "name": s.agent_config.name, "role": s.agent_config.role,
         "tools": s.agent_config.tools, "depends_on": s.depends_on}
        for s in dag.subtasks
    ]

    return {
        "intent": dag.intent,
        "subtasks": subtask_info,
        "parallel_groups": dag.parallel_groups,
        "subtask_count": len(dag.subtasks),
    }


# ── Execution ──

DEFAULT_MODEL_MAP = {
    "web_searcher": "qwen3:4b",
    "data_analyst": "qwen3:8b",
    "coder": "qwen3:8b",
    "writer": "qwen3:4b",
    "reviewer": "qwen3.5:35b",
}

@app.post("/execute")
async def execute_task(query: str = Query(...), task_id: str = Query(...), lang: str = Query(default="en")):
    """Start task execution in background. Events streamed via /events/{task_id}."""
    _event_queues[task_id] = asyncio.Queue()
    task = asyncio.ensure_future(_run_task(task_id, query, lang))
    task.add_done_callback(lambda t: logger.error(f"Task {task_id} crashed: {t.exception()}") if t.exception() else None)
    # Push initial event immediately so clients know the task has started
    _push_event(task_id, {"type": "exec_state", "state": "decomposing"})
    return {"task_id": task_id, "status": "started"}


async def _run_task(task_id: str, query: str, lang: str):
    try:
        await _do_run_task(task_id, query, lang)
    except Exception as e:
        logger.exception(f"Task {task_id} failed")
        _push_event(task_id, {"type": "error", "msg": str(e), "code": "INTERNAL_ERROR"})


async def _do_run_task(task_id: str, query: str, lang: str):
    settings = await _load_settings()
    tools = ToolRegistry()
    llm = LLMClient(base_url=settings["llm_base_url"], api_key=settings["llm_api_key"])
    factory = AgentFactory(available_tools=set(tools.available_tools()), default_model=settings["default_model"], model_map=DEFAULT_MODEL_MAP)
    state_manager = StateManager(checkpoint_dir="./checkpoints")
    budget = BudgetTracker(token_limit=int(settings.get("budget_token_limit", 200000)))
    llm.set_budget(budget)

    scheduler = MetaScheduler(
        llm=llm, decomposer_model=settings["decomposer_model"],
        available_tools=list(tools.available_tools()),
    )

    _push_event(task_id, {"type": "exec_state", "state": "decomposing"})
    dag = await scheduler.decompose(query, lang=lang)

    subtask_info = [
        {"id": s.id, "name": s.agent_config.name, "role": s.agent_config.role,
         "tools": s.agent_config.tools, "depends_on": s.depends_on}
        for s in dag.subtasks
    ]
    _push_event(task_id, {
        "type": "dag", "intent": dag.intent,
        "subtasks": subtask_info, "parallel_groups": dag.parallel_groups,
    })
    _push_event(task_id, {"type": "exec_state", "state": "streaming"})

    # Execute
    async def on_event(event_type: str, data: dict):
        match event_type:
            case "agent_start":
                _push_event(task_id, {
                    "type": "agent_start", "subtask_id": data["subtask_id"],
                    "agent_name": data["agent_name"], "role": data.get("role", ""),
                })
            case "agent_done":
                _push_event(task_id, {
                    "type": "agent_done", "subtask_id": data["subtask_id"],
                    "state": data["state"], "output": data.get("output", ""),
                    "error": data.get("error"), "retry_count": data.get("retry_count", 0),
                })
            case "tool_call":
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

    try:
        state = await orchestrator.execute(dag)
        results = [{"id": r.subtask_id, "state": r.state.value, "output": r.output, "error": r.error}
                   for r in state.subtask_results.values()]
        summary = orchestrator.aggregator.aggregate(list(state.subtask_results.values()))
        _push_event(task_id, {"type": "done", "summary": summary, "results": results})
    except Exception as e:
        _push_event(task_id, {"type": "error", "msg": str(e), "code": _classify_error(e)})
    finally:
        await asyncio.sleep(5)

    return {"task_id": task_id, "status": "completed" if "summary" in locals() else "error"}


# ── Cancel ──

@app.post("/cancel/{task_id}")
async def cancel_task(task_id: str):
    _cancel_flags[task_id] = True
    _push_event(task_id, {"type": "done", "summary": "Task cancelled"})
    return {"ok": True}


# ── SSE Event Stream ──

@app.get("/events/{task_id}")
async def event_stream(task_id: str):
    """SSE endpoint for real-time agent events."""
    q = _event_queues.get(task_id)
    if not q:
        q = asyncio.Queue()
        _event_queues[task_id] = q

    async def event_gen():
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=15.0)
            except asyncio.TimeoutError:
                yield ":ping\n\n"
                continue

            eid = event.get("event_id", 0)
            data = {k: v for k, v in event.items() if k != "event_id"}
            yield f"id: {eid}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

            if event.get("type") == "done":
                break

        _event_queues.pop(task_id, None)
        _cancel_flags.pop(task_id, None)

    return StreamingResponse(event_gen(), media_type="text/event-stream")


# ── Health ──

@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Trace ──

@app.get("/trace/{task_id}/{subtask_id}")
async def get_trace(task_id: str, subtask_id: str):
    """Return execution trace events for a specific agent."""
    import glob as _glob
    trace_dir = os.path.join(os.environ.get("AGENTSWARM_DATA_DIR", "data"), "traces")
    events = []
    if os.path.isdir(trace_dir):
        for f in sorted(_glob.glob(os.path.join(trace_dir, f"{task_id}*.jsonl"))):
            for line in open(f):
                try:
                    evt = json.loads(line)
                    if evt.get("subtask_id") == subtask_id:
                        events.append(evt)
                except json.JSONDecodeError:
                    pass
    return {"trace_events": events}


# ── Workspace ──

@app.get("/workspace/{conv_id}")
async def list_workspace(conv_id: str):
    """List files in the workspace directory for a conversation."""
    ws = os.path.join(os.environ.get("AGENTSWARM_DATA_DIR", "data"), "workspaces", conv_id)
    if not os.path.isdir(ws):
        return {"files": [], "path": ws}
    files = []
    for root, dirs, filenames in os.walk(ws):
        rel = os.path.relpath(root, ws)
        if rel == ".": rel = ""
        for d in dirs:
            files.append({"name": d, "path": os.path.join(rel, d) if rel else d, "type": "dir", "size": 0})
        for f in filenames:
            fp = os.path.join(root, f)
            files.append({"name": f, "path": os.path.join(rel, f) if rel else f, "type": "file", "size": os.path.getsize(fp)})
    files.sort(key=lambda x: (x["type"] != "dir", x["name"]))
    return {"files": files, "path": str(ws)}


@app.get("/workspace/{conv_id}/file")
async def read_file(conv_id: str, path: str = ""):
    """Read a file from the workspace."""
    fp = os.path.join(os.environ.get("AGENTSWARM_DATA_DIR", "data"), "workspaces", conv_id, path)
    if not os.path.isfile(fp):
        raise HTTPException(404, "File not found")
    try:
        content = open(fp, encoding="utf-8", errors="replace").read()
        return {"path": path, "content": content[:100000], "size": os.path.getsize(fp)}
    except Exception:
        return {"path": path, "content": "[Binary file]", "size": os.path.getsize(fp), "binary": True}


if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("AGENTSWARM_WORKER_HOST", "0.0.0.0")
    port = int(os.environ.get("AGENTSWARM_WORKER_PORT", "8001"))
    uvicorn.run(app, host=host, port=port)
