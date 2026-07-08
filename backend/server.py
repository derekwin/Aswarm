"""AgentSwarm Web Server — FastAPI + SSE real-time agent dashboard with async SQLite persistence."""

import asyncio
import json
import logging
import os
import shutil
import uuid as _uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
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
from agent_swarm.infrastructure.llm_client import LLMClient
from agent_swarm.infrastructure.tool_registry import ToolRegistry
from agent_swarm.trace import trace

from .storage import close_storage, get_storage

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
storage = get_storage()

_DATA_DIR = Path(os.environ.get("AGENTSWARM_DATA_DIR", "data"))
STATIC_DIR = Path(__file__).parent / "static"
WORKSPACE_ROOT = _DATA_DIR / "workspaces"
WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

_streams: dict[str, asyncio.Queue] = {}
_dag_snapshots: dict[str, dict] = {}
_cancel_flags: dict[str, bool] = {}
_event_ids: dict[str, int] = {}
_event_archive: dict[str, list[dict]] = {}  # circular buffer, last 100 events per task for replay
_MAX_ARCHIVE = 100

_default_settings = {
    "llm_base_url": os.environ.get("AGENTSWARM_LLM_BASE_URL", "http://localhost:11434/v1"),
    "llm_api_key": os.environ.get("AGENTSWARM_LLM_API_KEY", "ollama"),
    "decomposer_model": os.environ.get("AGENTSWARM_DECOMPOSER_MODEL", "qwen3:8b"),
    "default_model": os.environ.get("AGENTSWARM_DEFAULT_MODEL", "qwen3:8b"),
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
        if k in data and data[k]:
            current[k] = data[k]
    await _save_settings(current)
    return current


def _push_event(task_id: str, event: dict):
    q = _streams.get(task_id)
    if q:
        _event_ids[task_id] = _event_ids.get(task_id, 0) + 1
        event["event_id"] = _event_ids[task_id]
        q.put_nowait(event)
        # Archive for Last-Event-ID replay
        if task_id not in _event_archive:
            _event_archive[task_id] = []
        archive = _event_archive[task_id]
        archive.append(event)
        if len(archive) > _MAX_ARCHIVE:
            archive[:] = archive[-_MAX_ARCHIVE:]


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


@app.get("/api/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    conv = await storage.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    conv["messages"] = await storage.get_messages(conv_id)
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

    task_id = f"task_{_uuid.uuid4().hex[:12]}"
    _streams[task_id] = asyncio.Queue()
    await storage.create_task(task_id, conv_id, query)
    await storage.add_message(conv_id, "user", query)
    asyncio.create_task(_execute_task(task_id, conv_id, query, lang))
    return {"task_id": task_id, "conv_id": conv_id}


@app.get("/stream/{task_id}")
async def stream(task_id: str, last_event_id: int = Query(default=0)):
    q = _streams.get(task_id)
    if not q:
        # If no live queue but we have archived events, serve them + done signal
        if task_id in _event_archive:
            async def archived_gen():
                for evt in _event_archive[task_id]:
                    if evt.get("event_id", 0) > last_event_id:
                        eid = evt["event_id"]
                        data = {k: v for k, v in evt.items() if k != "event_id"}
                        yield f"id: {eid}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
                # End stream with done signal
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return StreamingResponse(archived_gen(), media_type="text/event-stream")
        return StreamingResponse(_event_stream_empty(), media_type="text/event-stream")

    async def event_gen():
        # Replay missed events if Last-Event-ID provided
        if last_event_id > 0 and task_id in _event_archive:
            for evt in _event_archive[task_id]:
                if evt.get("event_id", 0) > last_event_id:
                    eid = evt["event_id"]
                    data = {k: v for k, v in evt.items() if k != "event_id"}
                    yield f"id: {eid}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

        snapshot = _dag_snapshots.get(task_id)
        if snapshot and last_event_id == 0:
            _event_ids[task_id] = _event_ids.get(task_id, 0) + 1
            eid = _event_ids[task_id]
            yield f"id: {eid}\ndata: {json.dumps(snapshot, ensure_ascii=False)}\n\n"

        last_heartbeat = asyncio.get_event_loop().time()
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=15.0)
            except asyncio.TimeoutError:
                now = asyncio.get_event_loop().time()
                if now - last_heartbeat >= 14:
                    yield ":ping\n\n"
                    last_heartbeat = now
                continue

            eid = event.get("event_id", _event_ids.get(task_id, 0))
            data = {k: v for k, v in event.items() if k != "event_id"}
            yield f"id: {eid}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
            if event.get("type") == "done":
                break

    return StreamingResponse(event_gen(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


async def _event_stream_empty():
    yield f"data: {json.dumps({'type': 'error', 'msg': 'task not found'})}\n\n"


# ── Cancel Task ──

@app.post("/cancel/{task_id}")
async def cancel_task(task_id: str):
    _cancel_flags[task_id] = True
    await storage.update_task(task_id, "cancelled")
    _push_event(task_id, {"type": "done", "summary": "Task cancelled by user", "results": []})
    return {"ok": True}


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

    new_task_id = f"rerun_{task_id}_{subtask_id}_{len(_streams)}"
    _streams[new_task_id] = asyncio.Queue()
    await storage.create_task(new_task_id, task["conversation_id"], f"Rerun: {target_subtask.get('name', subtask_id)}")

    new_subtasks = [s for s in dag_data["subtasks"] if s["id"] in downstream_ids]
    new_query = f"Rerun subtask {target_subtask.get('name', subtask_id)}: {target_subtask.get('prompt', '')}"
    asyncio.create_task(_execute_rerun(new_task_id, task["conversation_id"], new_query, new_subtasks, dag_data["parallel_groups"]))

    return {"task_id": new_task_id, "conv_id": task["conversation_id"], "rerun_subtasks": list(downstream_ids)}


# ── Task Execution ──

async def _execute_task(task_id: str, conv_id: str, query: str, lang: str = "en"):
    try:
        settings = await _load_settings()
        ws = WORKSPACE_ROOT / conv_id
        os.environ["AGENTSWARM_WORKSPACE"] = str(ws)

        tools = ToolRegistry()
        llm = LLMClient(base_url=settings["llm_base_url"], api_key=settings["llm_api_key"])
        factory = AgentFactory(available_tools=set(tools.available_tools()), default_model=settings["default_model"])
        state_manager = StateManager(
            checkpoint_dir=os.environ.get("AGENTSWARM_CHECKPOINT_DIR", "./checkpoints"),
        )

        scheduler = MetaScheduler(
            llm=llm,
            decomposer_model=settings["decomposer_model"],
            available_tools=list(tools.available_tools()),
        )

        role_verb = {"web_searcher": "searching", "data_analyst": "analyzing", "coder": "coding", "writer": "writing", "reviewer": "reviewing"}

        async def on_orchestrator_event(event_type: str, data: dict):
            match event_type:
                case "agent_start":
                    trace.record("agent_start", task_id, subtask_id=data["subtask_id"], agent_name=data["agent_name"])
                    _push_event(task_id, {
                        "type": "agent_start", "subtask_id": data["subtask_id"],
                        "agent_name": data["agent_name"], "role": data.get("role", ""),
                    })
                    verb = role_verb.get(data.get("role", ""), "working")
                    _push_event(task_id, {"type": "status", "msg": f"{data['agent_name']} is {verb}..."})
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
            on_event=on_orchestrator_event,
            is_cancelled=lambda: _cancel_flags.get(task_id, False),
        )

        _push_event(task_id, {"type": "status", "msg": "Decomposing task..."})
        _push_event(task_id, {"type": "exec_state", "state": "decomposing"})
        dag: TaskDAG = await scheduler.decompose(query, lang=lang)

        trace.record("dag_generated", task_id, data={"subtasks": len(dag.subtasks), "groups": len(dag.parallel_groups)})
        await storage.update_task(task_id, "running", dag.intent, len(dag.subtasks))
        await storage.update_conversation_title(conv_id, query[:40])

        subtask_info = [
            {"id": s.id, "name": s.agent_config.name, "role": s.agent_config.role,
             "tools": s.agent_config.tools, "depends_on": s.depends_on}
            for s in dag.subtasks
        ]
        _push_event(task_id, {
            "type": "dag", "intent": dag.intent,
            "subtasks": subtask_info, "parallel_groups": dag.parallel_groups,
        })
        _dag_snapshots[task_id] = {"type": "dag", "intent": dag.intent, "subtasks": subtask_info, "parallel_groups": dag.parallel_groups}
        await storage.store_dag_data(task_id, json.dumps({"intent": dag.intent, "subtasks": subtask_info, "parallel_groups": dag.parallel_groups}))
        _push_event(task_id, {"type": "status", "msg": "Agents starting..."})
        _push_event(task_id, {"type": "exec_state", "state": "streaming"})

        state: SwarmState = await orchestrator.execute(dag)

        results = [
            {"id": r.subtask_id, "state": r.state.value,
             "output": r.output, "error": r.error}
            for r in state.subtask_results.values()
        ]

        summary = orchestrator.aggregator.aggregate(list(state.subtask_results.values()))
        await storage.update_task(task_id, "completed")
        await storage.add_message(conv_id, "assistant", summary)

        _push_event(task_id, {
            "type": "done", "summary": summary, "results": results,
        })
        trace.record("task_complete", task_id, data={"results": len(results)})
        trace.flush(task_id)

    except Exception as e:
        error_code = _classify_error(e)
        logger.exception(f"Task {task_id} failed")
        trace.record("task_error", task_id, data={"error": str(e), "code": error_code})
        trace.flush(task_id)
        await storage.update_task(task_id, "failed")
        _push_event(task_id, {"type": "error", "msg": str(e), "code": error_code})

    finally:
        await asyncio.sleep(30)
        _streams.pop(task_id, None)
        _cancel_flags.pop(task_id, None)
        _event_ids.pop(task_id, None)


async def _execute_rerun(task_id: str, conv_id: str, query: str, subtasks: list, parallel_groups: list):
    """Execute a partial rerun of specific subtasks from a DAG."""
    from agent_swarm.models import AgentConfig, Subtask, TaskDAG

    try:
        settings = await _load_settings()
        tools = ToolRegistry()
        llm = LLMClient(base_url=settings["llm_base_url"], api_key=settings["llm_api_key"])
        factory = AgentFactory(available_tools=set(tools.available_tools()), default_model=settings["default_model"])
        state_manager = StateManager(
            checkpoint_dir=os.environ.get("AGENTSWARM_CHECKPOINT_DIR", "./checkpoints"),
        )

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

        subtask_info = [
            {"id": s.id, "name": s.agent_config.name, "role": s.agent_config.role,
             "tools": s.agent_config.tools, "depends_on": s.depends_on}
            for s in dag.subtasks
        ]
        _push_event(task_id, {
            "type": "dag", "intent": "rerun",
            "subtasks": subtask_info, "parallel_groups": dag.parallel_groups,
        })
        _dag_snapshots[task_id] = {"type": "dag", "intent": "rerun", "subtasks": subtask_info, "parallel_groups": dag.parallel_groups}

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
        _streams.pop(task_id, None)
        _dag_snapshots.pop(task_id, None)


def _classify_error(e: Exception) -> str:
    msg = str(e).lower()
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


# ── Periodic Sync ──

async def _periodic_sync(interval_sec: int = 300):
    """Background task: periodically align workspaces with database."""
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
                        shutil.rmtree(d)
                        logger.info(f"Cleaned orphan workspace: {d.name}")
        except Exception as e:
            logger.warning(f"Periodic sync failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
