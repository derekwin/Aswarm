"""AgentSwarm Web Server — FastAPI + WebSocket real-time agent dashboard with async SQLite persistence."""

import asyncio
import json
import logging
import os
import shutil
import uuid as _uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

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

from .storage import close_storage, get_storage
from .task_executor import execute_task, execute_resume, execute_rerun

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup: sync workspaces with DB, start periodic sync task."""
    convs = await storage.list_conversations()
    for c in convs:
        (WORKSPACE_ROOT / c["id"]).mkdir(parents=True, exist_ok=True)
    if WORKSPACE_ROOT.exists():
        db_ids = {c["id"] for c in convs}
        for d in list(WORKSPACE_ROOT.iterdir()):
            if d.is_dir() and d.name not in db_ids:
                shutil.rmtree(d)
    sync_task = asyncio.create_task(_periodic_sync())
    yield
    sync_task.cancel()
    try:
        await sync_task
    except asyncio.CancelledError:
        pass
    await close_storage()


app = FastAPI(title="AgentSwarm Dashboard", lifespan=lifespan)

# ── Rate limiter ──

RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 30      # requests per window per IP
_rate_limit_buckets: dict[str, list[float]] = {}

import time as _time

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    # Skip static assets and health checks
    path = request.url.path
    if path.startswith("/assets") or path.startswith("/static") or path == "/api/health":
        return await call_next(request)

    client = request.client.host if request.client else "unknown"
    now = _time.time()
    bucket = _rate_limit_buckets.setdefault(client, [])
    bucket[:] = [t for t in bucket if now - t < RATE_LIMIT_WINDOW]

    if len(bucket) >= RATE_LIMIT_MAX:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests", "retry_after": RATE_LIMIT_WINDOW},
            headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
        )
    bucket.append(now)
    return await call_next(request)

# Global exception handler to avoid leaking internal details
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(_request: Request, exc: Exception):
    logger.exception("Unhandled exception")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

storage = get_storage()

_DATA_DIR = Path(os.environ.get("AGENTSWARM_DATA_DIR", "data"))
STATIC_DIR = Path(__file__).parent / "static"
WORKSPACE_ROOT = _DATA_DIR / "workspaces"
WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

from backend.ws_manager import ConnectionManager

manager = ConnectionManager()
_cancel_flags: dict[str, bool] = {}
_approval_events: dict[str, asyncio.Event] = {}  # task_id -> event, set when user approves/rejects
_approval_decisions: dict[str, dict] = {}  # task_id -> {"approved": bool, "feedback": str}

_default_settings = {
    "llm_base_url": os.environ.get("AGENTSWARM_LLM_BASE_URL", "http://localhost:11434/v1"),
    "llm_api_key": os.environ.get("AGENTSWARM_LLM_API_KEY", "ollama"),
    "decomposer_model": os.environ.get("AGENTSWARM_DECOMPOSER_MODEL", "qwen3:8b"),
    "default_model": os.environ.get("AGENTSWARM_DEFAULT_MODEL", "qwen3:8b"),
    "budget_token_limit": int(os.environ.get("AGENTSWARM_BUDGET_TOKENS", "200000")),
}


async def _load_settings() -> dict:
    """Load settings: user-saved DB settings > env var defaults."""
    settings = dict(_default_settings)
    db_settings = await storage.get_settings()
    settings.update(db_settings)
    return settings


async def _save_settings(data: dict):
    await storage.save_settings(data)


# ── Settings API ──

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/settings")
async def get_settings():
    return await _load_settings()


@app.put("/api/settings")
async def update_settings(data: dict):
    current = await _load_settings()
    for k in _default_settings:
        if k in data and data[k] is not None:
            current[k] = data[k]
    await _save_settings(current)
    return current


def _push_event(task_id: str, event: dict):
    """Broadcast event to all WebSocket subscribers of this task."""
    event["task_id"] = task_id
    asyncio.create_task(manager.broadcast(task_id, event))


# ── Static ──

@app.get("/", response_class=HTMLResponse)
async def index():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


# ── Conversations API ──

@app.get("/api/conversations")
async def list_conversations():
    return await storage.list_conversations()


@app.post("/api/conversations")
async def create_conversation(title: str = Query(default="New Task")):
    convs = await storage.list_conversations()
    conv_id = f"conv_{_uuid.uuid4().hex[:12]}"
    conv = await storage.create_conversation(conv_id, title)
    (WORKSPACE_ROOT / conv_id).mkdir(parents=True, exist_ok=True)
    return conv


@app.get("/api/conversations/{conv_id}/task")
async def get_latest_task(conv_id: str):
    task = await storage.get_latest_task(conv_id)
    if not task:
        return {"task": None}
    results = await storage.get_agent_results(task["id"])
    return {"task": task, "agent_results": results}


MAX_MESSAGES = 500

@app.get("/api/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    conv = await storage.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    messages = await storage.get_messages(conv_id)
    conv["messages"] = messages[-MAX_MESSAGES:]
    return conv


@app.delete("/api/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    await storage.delete_conversation(conv_id)
    ws = WORKSPACE_ROOT / conv_id
    if ws.exists():
        shutil.rmtree(ws)
    return {"ok": True}


# ── Maintenance / Sync ──

@app.post("/api/sync")
async def sync_workspaces():
    """Align workspace directories with database conversations."""
    convs = await storage.list_conversations()
    db_ids = {c["id"] for c in convs}

    created = 0
    for c in convs:
        ws = WORKSPACE_ROOT / c["id"]
        if not ws.exists():
            ws.mkdir(parents=True, exist_ok=True)
            created += 1

    removed = 0
    if WORKSPACE_ROOT.exists():
        for d in WORKSPACE_ROOT.iterdir():
            if d.is_dir() and d.name not in db_ids:
                shutil.rmtree(d)
                removed += 1

    return {"created": created, "removed": removed, "total": len(convs)}


# ── Workspace API ──

@app.get("/api/workspace/{conv_id}")
async def list_workspace(conv_id: str):
    ws = WORKSPACE_ROOT / conv_id
    if not ws.exists():
        return {"files": [], "path": str(ws)}
    files = []
    for root, dirs, filenames in os.walk(ws):
        rel = os.path.relpath(root, ws)
        if rel == ".":
            rel = ""
        for d in dirs:
            files.append({"name": d, "path": os.path.join(rel, d) if rel else d, "type": "dir", "size": 0})
        for f in filenames:
            fp = os.path.join(root, f)
            files.append({"name": f, "path": os.path.join(rel, f) if rel else f, "type": "file", "size": os.path.getsize(fp)})
    files.sort(key=lambda x: (x["type"] != "dir", x["name"]))
    return {"files": files, "path": str(ws)}


@app.get("/api/workspace/{conv_id}/file")
async def read_workspace_file(conv_id: str, path: str = ""):
    fp = WORKSPACE_ROOT / conv_id / path
    if not fp.exists() or not fp.is_file():
        raise HTTPException(404, "File not found")
    try:
        content = fp.read_text(encoding="utf-8", errors="replace")
        return {"path": path, "content": content[:100000], "size": fp.stat().st_size}
    except Exception:
        return {"path": path, "content": "[Binary file - cannot preview]", "size": fp.stat().st_size, "binary": True}


@app.get("/api/workspace/{conv_id}/download")
async def download_workspace_file(conv_id: str, path: str = ""):
    fp = WORKSPACE_ROOT / conv_id / path
    if not fp.exists() or not fp.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(fp, filename=os.path.basename(path))


# ── File Upload ──

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    content = ""
    filename = file.filename or "unknown"
    try:
        raw = await file.read()
        if filename.lower().endswith(".pdf"):
            from io import BytesIO

            from PyPDF2 import PdfReader
            reader = PdfReader(BytesIO(raw))
            content = "\n".join(page.extract_text() or "" for page in reader.pages)
        elif filename.lower().endswith((".txt", ".md", ".py", ".json", ".csv", ".log", ".yaml", ".yml")):
            content = raw.decode("utf-8", errors="replace")
        else:
            content = raw.decode("utf-8", errors="replace")
        return {"filename": filename, "content": content[:50000], "size": len(raw)}
    except Exception as e:
        return {"filename": filename, "error": str(e), "size": len(raw)}


# ── Run Task ──

MAX_QUERY_LENGTH = 10000


@app.post("/run")
async def run_task(query: str = Query(...), conv_id: str = Query(default=""), lang: str = Query(default="en")):
    query = query.strip()
    if not query:
        raise HTTPException(400, "Query cannot be empty")
    if len(query) > MAX_QUERY_LENGTH:
        raise HTTPException(400, f"Query exceeds max length of {MAX_QUERY_LENGTH}")
    if conv_id and len(conv_id) > 100:
        raise HTTPException(400, "Invalid conversation ID")
    if not conv_id:
        convs = await storage.list_conversations()
        conv_id = f"conv_{_uuid.uuid4().hex[:12]}"
        await storage.create_conversation(conv_id, "New Task")
        (WORKSPACE_ROOT / conv_id).mkdir(parents=True, exist_ok=True)

    # Idempotency: if a running task exists for this conv, return it
    if conv_id:
        existing = await storage.get_latest_task(conv_id)
        if existing and existing["status"] == "running":
            return {"task_id": existing["id"], "conv_id": conv_id, "existing": True}

    task_id = f"task_{_uuid.uuid4().hex[:12]}"
    await storage.create_task(task_id, conv_id, query)
    await storage.add_message(conv_id, "user", query)
    asyncio.create_task(_execute_task(task_id, conv_id, query, lang))
    return {"task_id": task_id, "conv_id": conv_id}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            msg = await ws.receive_json()
            action = msg.get("action", "")
            task_id = msg.get("task_id", "")
            match action:
                case "subscribe":
                    task = await storage.get_task(task_id)
                    if not task:
                        await ws.send_json({"type": "error", "task_id": task_id, "msg": "Task not found", "code": "NOT_FOUND"})
                        continue
                    conv_id = msg.get("conv_id", "")
                    if conv_id and task["conversation_id"] != conv_id:
                        await ws.send_json({"type": "error", "task_id": task_id, "msg": "Access denied", "code": "FORBIDDEN"})
                        continue
                    await manager.subscribe(ws, task_id)
                case "unsubscribe":
                    await manager.unsubscribe(ws, task_id)
                case "cancel":
                    _cancel_flags[task_id] = True
                    await storage.update_task(task_id, "cancelled")
                    _push_event(task_id, {"type": "done", "summary": "Task cancelled by user"})
                case "ping":
                    await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        await manager.disconnect(ws)


# ── Cancel Task ──

@app.post("/cancel/{task_id}")
async def cancel_task(task_id: str):
    _cancel_flags[task_id] = True
    # Wake up any waiting approval
    evt = _approval_events.get(task_id)
    if evt:
        evt.set()
    await storage.update_task(task_id, "cancelled")
    _push_event(task_id, {"type": "done", "summary": "Task cancelled by user", "results": []})
    return {"ok": True}


# ── HITL Approval API ──

@app.post("/api/approve/{task_id}/{subtask_id}")
async def approve_action(task_id: str, subtask_id: str, approved: bool = Query(default=True), feedback: str = Query(default="")):
    """Approve or reject an agent's pending approval request."""
    decision = {"approved": approved, "feedback": feedback, "subtask_id": subtask_id}
    _approval_decisions[task_id] = decision
    evt = _approval_events.get(task_id)
    if evt:
        evt.set()
    return {"ok": True, "approved": approved}


# ── Trace API ──

@app.get("/api/trace/{task_id}/{subtask_id}")
async def get_agent_trace(task_id: str, subtask_id: str):
    """Return full execution trace for a specific agent subtask."""
    results = await storage.get_agent_results(task_id)
    agent_result = None
    for r in results:
        if r["subtask_id"] == subtask_id:
            agent_result = r
            break
    if not agent_result:
        raise HTTPException(404, "Subtask not found")

    trace_events: list = []
    trace_dir = Path(os.environ.get("AGENTSWARM_DATA_DIR", "data")) / "traces"
    if trace_dir.exists():
        for f in sorted(trace_dir.iterdir()):
            if f.name.startswith(task_id) and f.suffix == ".jsonl":
                for line in f.read_text().splitlines():
                    try:
                        evt = json.loads(line)
                        if evt.get("subtask_id") == subtask_id or evt.get("agent_name") == agent_result["agent_name"]:
                            trace_events.append(evt)
                    except json.JSONDecodeError:
                        pass

    task = await storage.get_task(task_id)
    prompt = ""
    if task and task.get("dag_data"):
        try:
            dag = json.loads(task["dag_data"])
            for s in dag.get("subtasks", []):
                if s["id"] == subtask_id:
                    prompt = s.get("prompt", "")
                    break
        except json.JSONDecodeError:
            pass

    return {
        "subtask_id": subtask_id,
        "agent_name": agent_result["agent_name"],
        "state": agent_result["state"],
        "output": agent_result.get("output"),
        "error": agent_result.get("error"),
        "prompt": prompt,
        "retry_count": agent_result.get("retry_count", 0),
        "trace_events": trace_events,
    }


# ── Checkpoint API ──

@app.get("/api/checkpoints/{task_id}")
async def list_checkpoints(task_id: str):
    """List available checkpoints for a task with metadata."""
    state_manager = StateManager(
        checkpoint_dir=os.environ.get("AGENTSWARM_CHECKPOINT_DIR", "./checkpoints"),
    )
    return await asyncio.to_thread(state_manager.list_checkpoints, task_id)


@app.post("/api/checkpoints/{task_id}/resume")
async def resume_from_checkpoint(task_id: str, checkpoint_path: str = Query(default="")):
    """Resume task execution from a specific checkpoint."""
    convs = await storage.list_conversations()
    task = await storage.get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    new_task_id = f"resume_{task_id}_{_uuid.uuid4().hex[:6]}"
    await storage.create_task(new_task_id, task["conversation_id"], f"Resume from checkpoint: {task.get('query', task_id)}")
    asyncio.create_task(_execute_resume(new_task_id, task_id, checkpoint_path or None))
    return {"task_id": new_task_id, "original_task_id": task_id}


async def _execute_resume(new_task_id: str, original_task_id: str, checkpoint_path: str | None):
    """Execute a task resumed from a checkpoint."""
    await execute_resume(new_task_id, original_task_id, checkpoint_path,
        _load_settings=_load_settings, _push_event=_push_event, storage=storage, manager=manager,
        _cancel_flags=_cancel_flags, _approval_events=_approval_events, _approval_decisions=_approval_decisions)


# ── Rerun API ──

@app.post("/api/rerun/{task_id}/{subtask_id}")
async def rerun_subtask(task_id: str, subtask_id: str, prompt: str = Query(default="")):
    """Rerun a specific subtask with an optional edited prompt."""
    task = await storage.get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if not task.get("dag_data"):
        raise HTTPException(400, "DAG data not available for rerun")

    try:
        dag_data = json.loads(task["dag_data"])
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid DAG data")

    target_subtask = None
    downstream_ids: set = {subtask_id}
    for s in dag_data.get("subtasks", []):
        if s["id"] == subtask_id:
            target_subtask = s
            break
    if not target_subtask:
        raise HTTPException(404, "Subtask not found in DAG")

    changed = True
    while changed:
        changed = False
        for s in dag_data.get("subtasks", []):
            if s["id"] in downstream_ids:
                continue
            if any(dep in downstream_ids for dep in s.get("depends_on", [])):
                downstream_ids.add(s["id"])
                changed = True

    if prompt:
        target_subtask["prompt"] = prompt

    new_task_id = f"rerun_{task_id}_{subtask_id}_{_uuid.uuid4().hex[:6]}"
    await storage.create_task(new_task_id, task["conversation_id"], f"Rerun: {target_subtask.get('name', subtask_id)}")

    new_subtasks = [s for s in dag_data["subtasks"] if s["id"] in downstream_ids]
    new_query = f"Rerun subtask {target_subtask.get('name', subtask_id)}: {target_subtask.get('prompt', '')}"
    asyncio.create_task(_execute_rerun(new_task_id, task["conversation_id"], new_query, new_subtasks, dag_data["parallel_groups"]))

    return {"task_id": new_task_id, "conv_id": task["conversation_id"], "rerun_subtasks": list(downstream_ids)}


# ── Task Execution ──

async def _execute_task(task_id: str, conv_id: str, query: str, lang: str = "en"):
    await execute_task(task_id, conv_id, query, lang,
        _load_settings=_load_settings, _push_event=_push_event, storage=storage, manager=manager,
        _cancel_flags=_cancel_flags, _approval_events=_approval_events, _approval_decisions=_approval_decisions,
        WORKSPACE_ROOT=WORKSPACE_ROOT)


async def _execute_rerun(task_id: str, conv_id: str, query: str, subtasks: list, parallel_groups: list):
    """Execute a partial rerun of specific subtasks from a DAG."""
    await execute_rerun(task_id, conv_id, query, subtasks, parallel_groups,
        _load_settings=_load_settings, _push_event=_push_event, storage=storage, manager=manager,
        _cancel_flags=_cancel_flags)


# ── Periodic Sync ──

async def _periodic_sync(interval_sec: int = 300):
    """Background task: periodically align workspaces with database and clean stale state."""
    while True:
        await asyncio.sleep(interval_sec)
        try:
            convs = await storage.list_conversations()
            db_ids = {c["id"] for c in convs}
            for c in convs:
                (WORKSPACE_ROOT / c["id"]).mkdir(parents=True, exist_ok=True)
            if WORKSPACE_ROOT.exists():
                for d in list(WORKSPACE_ROOT.iterdir()):
                    if d.is_dir() and d.name not in db_ids:
                        await asyncio.to_thread(shutil.rmtree, d)
                        logger.info(f"Cleaned orphan workspace: {d.name}")

            # Clean stale cancel flags for completed/failed/cancelled tasks
            for task_id in list(_cancel_flags.keys()):
                task = await storage.get_task(task_id)
                if not task or task["status"] in ("completed", "failed", "cancelled"):
                    _cancel_flags.pop(task_id, None)
                    _approval_events.pop(task_id, None)
                    _approval_decisions.pop(task_id, None)
        except Exception as e:
            logger.warning(f"Periodic sync failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
