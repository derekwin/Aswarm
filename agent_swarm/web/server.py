"""AgentSwarm Web Server — FastAPI + SSE real-time agent dashboard with SQLite persistence."""

import asyncio
import json
import logging
from pathlib import Path

from fastapi import FastAPI, Query, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from agent_swarm import (
    MetaScheduler, SwarmOrchestrator, AgentFactory,
    MCPGateway, StateManager, TaskDAG, SwarmState,
)
from agent_swarm.web.storage import get_storage

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="AgentSwarm Dashboard")
storage = get_storage()

STATIC_DIR = Path(__file__).parent / "static"
SETTINGS_FILE = Path("data/settings.json")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

_streams: dict[str, asyncio.Queue] = {}

_default_settings = {
    "llm_base_url": "http://localhost:11434/v1",
    "llm_api_key": "ollama",
    "classifier_model": "qwen3:4b",
    "decomposer_model": "qwen3.5:35b",
    "default_model": "qwen3.5:35b",
}


def _load_settings() -> dict:
    if SETTINGS_FILE.exists():
        return {**_default_settings, **json.loads(SETTINGS_FILE.read_text())}
    return dict(_default_settings)


def _save_settings(data: dict):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))


# ── Settings API ──

@app.get("/api/settings")
async def get_settings():
    return _load_settings()


@app.put("/api/settings")
async def update_settings(data: dict):
    current = _load_settings()
    for k in _default_settings:
        if k in data and data[k]:
            current[k] = data[k]
    _save_settings(current)
    return current


def _push_event(task_id: str, event: dict):
    q = _streams.get(task_id)
    if q:
        q.put_nowait(event)


# ── Static ──

@app.get("/", response_class=HTMLResponse)
async def index():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


# ── Conversations API ──

@app.get("/api/conversations")
async def list_conversations():
    return storage.list_conversations()


@app.post("/api/conversations")
async def create_conversation(title: str = Query(default="New Task")):
    conv_id = f"conv_{id(title)}_{len(storage.list_conversations())}"
    conv = storage.create_conversation(conv_id, title)
    return conv


@app.get("/api/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    conv = storage.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    conv["messages"] = storage.get_messages(conv_id)
    return conv


@app.delete("/api/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    storage.delete_conversation(conv_id)
    return {"ok": True}


# ── File Upload ──

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    content = ""
    filename = file.filename or "unknown"
    try:
        raw = await file.read()
        if filename.lower().endswith(".pdf"):
            from PyPDF2 import PdfReader
            from io import BytesIO
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

@app.post("/run")
async def run_task(query: str = Query(...), conv_id: str = Query(default="")):
    if not conv_id:
        conv_id = f"conv_{id(query)}_{len(storage.list_conversations())}"
        storage.create_conversation(conv_id, "New Task")

    task_id = f"task_{id(query)}_{len(_streams)}"
    _streams[task_id] = asyncio.Queue()
    storage.create_task(task_id, conv_id, query)
    storage.add_message(conv_id, "user", query)
    asyncio.create_task(_execute_task(task_id, conv_id, query))
    return {"task_id": task_id, "conv_id": conv_id}


@app.get("/stream/{task_id}")
async def stream(task_id: str):
    q = _streams.get(task_id)
    if not q:
        return StreamingResponse(_event_stream_empty(), media_type="text/event-stream")

    async def event_gen():
        while True:
            event = await q.get()
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            if event.get("type") == "done":
                break

    return StreamingResponse(event_gen(), media_type="text/event-stream")


async def _event_stream_empty():
    yield f"data: {json.dumps({'type': 'error', 'msg': 'task not found'})}\n\n"


# ── Task Execution ──

async def _execute_task(task_id: str, conv_id: str, query: str):
    try:
        settings = _load_settings()
        gateway = MCPGateway()
        factory = AgentFactory(gateway=gateway, default_model=settings["default_model"])
        state_manager = StateManager()

        scheduler = MetaScheduler(
            base_url=settings["llm_base_url"], api_key=settings["llm_api_key"],
            classifier_model=settings["classifier_model"], decomposer_model=settings["decomposer_model"],
        )

        orchestrator = SwarmOrchestrator(
            gateway=gateway, factory=factory, state_manager=state_manager,
            llm_base_url=settings["llm_base_url"], llm_api_key=settings["llm_api_key"],
            max_subtask_retries=2,
        )

        _push_event(task_id, {"type": "status", "msg": "Classifying task..."})

        dag: TaskDAG = await scheduler.process(query)
        storage.update_task(task_id, "running", dag.intent, len(dag.subtasks))
        storage.update_conversation_title(conv_id, query[:40])

        subtask_info = [
            {"id": s.id, "name": s.agent_config.name, "role": s.agent_config.role,
             "tools": s.agent_config.tools, "depends_on": s.depends_on}
            for s in dag.subtasks
        ]
        _push_event(task_id, {
            "type": "dag", "intent": dag.intent,
            "subtasks": subtask_info, "parallel_groups": dag.parallel_groups,
        })
        _push_event(task_id, {"type": "status", "msg": "Executing agents..."})

        original_run = orchestrator._run_single_agent

        async def hooked_run(subtask_id, agent, prompt, context=""):
            _push_event(task_id, {
                "type": "agent_start", "subtask_id": subtask_id,
                "agent_name": agent.name, "role": agent.role,
            })
            result = await original_run(subtask_id, agent, prompt, context)
            storage.add_agent_result(
                task_id, subtask_id, agent.name,
                result.state.value, result.output, result.error, result.retry_count,
            )
            _push_event(task_id, {
                "type": "agent_done", "subtask_id": subtask_id,
                "state": result.state.value,
                "output": (result.output or "")[:500],
                "error": result.error, "retry_count": result.retry_count,
            })
            return result

        orchestrator._run_single_agent = hooked_run
        state: SwarmState = await orchestrator.execute(dag)

        results = [
            {"id": r.subtask_id, "state": r.state.value,
             "output": r.output, "error": r.error}
            for r in state.subtask_results.values()
        ]

        summary = orchestrator.aggregator.aggregate(list(state.subtask_results.values()))
        storage.update_task(task_id, "completed")
        storage.add_message(conv_id, "assistant", summary)

        _push_event(task_id, {
            "type": "done", "summary": summary, "results": results,
        })

    except Exception as e:
        logger.exception(f"Task {task_id} failed")
        storage.update_task(task_id, "failed")
        _push_event(task_id, {"type": "error", "msg": str(e)})

    finally:
        await asyncio.sleep(30)
        _streams.pop(task_id, None)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
