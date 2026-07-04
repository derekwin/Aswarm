"""AgentSwarm Web Server — FastAPI + SSE real-time agent dashboard."""

import asyncio
import json
import logging
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from agent_swarm import (
    MetaScheduler, SwarmOrchestrator, AgentFactory,
    MCPGateway, StateManager, TaskDAG, SwarmState,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="AgentSwarm Dashboard")

STATIC_DIR = Path(__file__).parent / "static"

# In-memory event queues per task_id
_streams: dict[str, asyncio.Queue] = {}


def _push_event(task_id: str, event: dict):
    q = _streams.get(task_id)
    if q:
        q.put_nowait(event)


@app.get("/", response_class=HTMLResponse)
async def index():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.post("/run")
async def run_task(query: str = Query(...)):
    task_id = f"task_{id(query)}_{len(_streams)}"
    _streams[task_id] = asyncio.Queue()
    asyncio.create_task(_execute_task(task_id, query))
    return {"task_id": task_id}


@app.get("/stream/{task_id}")
async def stream(task_id: str):
    q = _streams.get(task_id)
    if not q:
        return StreamingResponse(
            _event_stream_empty(), media_type="text/event-stream"
        )

    async def event_gen():
        while True:
            event = await q.get()
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            if event.get("type") == "done":
                break

    return StreamingResponse(event_gen(), media_type="text/event-stream")


async def _event_stream_empty():
    yield f"data: {json.dumps({'type': 'error', 'msg': 'task not found'})}\n\n"


async def _execute_task(task_id: str, query: str):
    try:
        gateway = MCPGateway()
        factory = AgentFactory(gateway=gateway, default_model="qwen3.5:35b")
        state_manager = StateManager()

        scheduler = MetaScheduler(
            base_url="http://localhost:11434/v1",
            api_key="ollama",
            classifier_model="qwen3:4b",
            decomposer_model="qwen3.5:35b",
        )

        orchestrator = SwarmOrchestrator(
            gateway=gateway, factory=factory, state_manager=state_manager,
            llm_base_url="http://localhost:11434/v1", llm_api_key="ollama",
            max_subtask_retries=2,
        )

        _push_event(task_id, {"type": "status", "msg": "Classifying task..."})

        dag: TaskDAG = await scheduler.process(query)

        subtask_info = [
            {"id": s.id, "name": s.agent_config.name, "role": s.agent_config.role,
             "tools": s.agent_config.tools, "depends_on": s.depends_on}
            for s in dag.subtasks
        ]
        _push_event(task_id, {
            "type": "dag",
            "intent": dag.intent,
            "subtasks": subtask_info,
            "parallel_groups": dag.parallel_groups,
        })

        _push_event(task_id, {"type": "status", "msg": "Executing agents..."})

        # Hook into orchestrator to stream per-agent events
        original_run = orchestrator._run_single_agent

        async def hooked_run(subtask_id, agent, prompt, context=""):
            _push_event(task_id, {
                "type": "agent_start", "subtask_id": subtask_id,
                "agent_name": agent.name, "role": agent.role,
            })
            result = await original_run(subtask_id, agent, prompt, context)
            _push_event(task_id, {
                "type": "agent_done", "subtask_id": subtask_id,
                "state": result.state.value,
                "output": (result.output or "")[:500],
                "error": result.error,
                "retry_count": result.retry_count,
            })
            return result

        orchestrator._run_single_agent = hooked_run

        state: SwarmState = await orchestrator.execute(dag)

        results = [
            {"id": r.subtask_id, "state": r.state.value,
             "output": r.output, "error": r.error}
            for r in state.subtask_results.values()
        ]

        _push_event(task_id, {
            "type": "done",
            "summary": orchestrator.aggregator.aggregate(list(state.subtask_results.values())),
            "results": results,
        })

    except Exception as e:
        logger.exception(f"Task {task_id} failed")
        _push_event(task_id, {"type": "error", "msg": str(e)})

    finally:
        # Clean up after 30 seconds
        await asyncio.sleep(30)
        _streams.pop(task_id, None)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
