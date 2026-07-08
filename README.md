# AgentSwarm

AI-driven task decomposition and parallel agent execution system. Describe a complex task in natural language, and AgentSwarm breaks it into a DAG of subtasks, dispatches specialized LLM agents to execute them in parallel, and streams real-time progress back to a visual orchestration dashboard.

## Features

- **Natural Language Task Decomposition** — Describe what you want; the system plans how to do it
- **DAG Visualization** — Interactive dagre+D3 graph with agent dependencies and real-time status
- **Real-time Monitoring** — Live agent progress, tool calls, and outputs via SSE with heartbeat keep-alive
- **Multi-turn Conversations** — Persistent chat history with task reconnection on page reload
- **Task Execution State Machine** — Full lifecycle: idle → connecting → decomposing → streaming → completed/failed/cancelled
- **Agent Debugging** — Right-click any node to View Details, Retry with edited prompt, or Copy Prompt
- **Agent Trace** — Click a node to see full execution trace: prompt, tool calls, iterations, output
- **Global Progress Bar** — Real-time "4/8 completed" progress with percentage bar
- **Log Search & JSON Highlighting** — Filter logs by keyword, auto-pause on scroll-up, formatted JSON blocks
- **Export Reports** — One-click Markdown export of full conversation history
- **Quick Start Examples** — 3 preset scenarios on first launch (Market Research, Code Generation, Tech Comparison)
- **Tab Notifications** — Browser title flashes ✓/✗ when task completes or fails
- **Multi-Provider** — Supports Ollama (local), OpenAI, and Anthropic backends
- **Dark Tool Aesthetic** — Tailwind-powered responsive UI with zoomable DAG canvas

## Quick Start

### Prerequisites

- Python ≥ 3.10
- Node.js ≥ 18
- [Ollama](https://ollama.com) (for local LLM)

### Install

```bash
git clone <repo-url> && cd agentSwarm
pip install -e ".[server]"

# Pull models (recommended)
ollama pull qwen3:4b
ollama pull qwen3.5:35b

# Install frontend dependencies
cd frontend && npm install
```

### Run

```bash
# Build frontend (production)
cd frontend && npm run build && cd ..

# Start backend
python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000

# Or dev mode (frontend hot-reload)
cd frontend && npm run dev
```

Open `http://localhost:8000` (production) or `http://localhost:5173` (dev).

### Docker

```bash
docker compose up -d
```

## Configuration

All settings via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTSWARM_LLM_BASE_URL` | `http://localhost:11434/v1` | LLM API endpoint |
| `AGENTSWARM_LLM_API_KEY` | `ollama` | API key |
| `AGENTSWARM_DECOMPOSER_MODEL` | `qwen3.5:35b` | Model for task decomposition |
| `AGENTSWARM_DEFAULT_MODEL` | `qwen3.5:35b` | Default agent model |
| `AGENTSWARM_DATA_DIR` | `./data` | SQLite DB, settings, workspaces, traces |
| `AGENTSWARM_CHECKPOINT_DIR` | `./checkpoints` | Task checkpoint JSONs |

Copy `.env.example` to `.env` and customize.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Server health check |
| `GET/PUT` | `/api/settings` | LLM settings |
| `POST` | `/run?query=...` | Submit a task |
| `GET` | `/stream/{task_id}` | SSE event stream |
| `POST` | `/cancel/{task_id}` | Cancel running task |
| `POST` | `/api/rerun/{task_id}/{subtask_id}` | Rerun subtask with optional new prompt |
| `GET` | `/api/trace/{task_id}/{subtask_id}` | Agent execution trace |
| `GET/DELETE` | `/api/conversations` | Conversation management |

## Project Structure

```
agnetSwarm/
├── agent_swarm/          # Core agent orchestration library
│   ├── meta_scheduler.py   # Task decomposition & DAG planning
│   ├── orchestrator.py     # Parallel agent execution engine
│   ├── agent_factory.py    # LLM agent instantiation
│   ├── mcp_gateway.py      # Tool integration gateway
│   ├── state_manager.py    # Checkpointing & recovery
│   ├── context.py          # Smart context compression
│   ├── models.py           # Pydantic data models
│   └── trace.py            # Execution tracing
├── backend/              # Web server
│   ├── server.py           # FastAPI + SSE streaming + REST API
│   └── storage.py          # SQLite persistence layer
├── frontend/             # React + TypeScript dashboard
│   └── src/
│       ├── components/     # DAGView, AgentDetailPanel, ResultStream, ...
│       ├── context/        # AppContext, ConvContext (state machine), UIContext
│       ├── hooks/          # useTaskRunner (SSE + retry + cancel), useT (i18n)
│       └── types/          # TypeScript interfaces + auto-generated api.ts
├── scripts/              # Utilities
│   └── generate_types.py   # Pydantic → TypeScript type generator
├── tests/                # 67 tests (pytest + backend API)
├── examples/             # Usage examples
└── docs/plans/           # Design documents
```

## Development

```bash
# Python
pip install -e ".[dev,server]"
python -m pytest tests/ -v --cov=agent_swarm
python -m ruff check agent_swarm/ backend/ tests/
python -m mypy agent_swarm/ backend/ --ignore-missing-imports

# Frontend
cd frontend
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
npm run test            # vitest
npm run build           # production build

# Type generation (run after model changes)
python scripts/generate_types.py > frontend/src/types/api.ts
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Tailwind CSS 4, D3.js, dagre |
| Backend | FastAPI, Python 3.10+, SSE, SQLite |
| LLM | Ollama (primary), OpenAI, Anthropic |
| Build | Vite, Hatchling |
| Testing | pytest, vitest, mypy, ruff, ESLint |

