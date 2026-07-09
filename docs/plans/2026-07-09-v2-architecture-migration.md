# AgentSwarm v2 — Architecture Migration Plan

> Python Core + TypeScript Web Layer
> Date: 2026-07-09

## Architecture

```
┌─ Next.js 14 (App Router) — /app ─────────────────────────────┐
│                                                               │
│  ┌─ page.tsx ────────────────────────────────────────────┐   │
│  │  Server Component (RSC) — zero client JS               │   │
│  │  Fetches conversations via tRPC at build/request time  │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─ api/trpc/[trpc].ts ──────────────────────────────────┐   │
│  │  tRPC router: conversations, tasks, settings, files    │   │
│  │  All input/output types auto-derived from Zod schemas  │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─ api/task/[taskId]/stream/route.ts ───────────────────┐   │
│  │  SSE endpoint: ReadableStream piping agent events      │   │
│  │  From Python worker → tRPC → SSE → browser             │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─ lib/ ────────────────────────────────────────────────┐   │
│  │  prisma.ts — typed DB client                           │   │
│  │  python.ts — HTTP client to local Python worker        │   │
│  │  trpc.ts — server-side tRPC caller                     │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─ Agent Worker (localhost:8001) ───────────────────────┐   │
│  │  Python FastAPI — thin HTTP wrapper                    │   │
│  │  POST /decompose  → meta_scheduler.decompose()         │   │
│  │  POST /execute    → orchestrator.execute()             │   │
│  │  POST /cancel     → cancel flag set                    │   │
│  │  SSE /events/{id} → agent events stream                │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  Prisma SQLite — shared between Next.js and Python            │
└───────────────────────────────────────────────────────────────┘
```

## Layer Responsibilities

### Next.js (TypeScript) — Web Layer
- **Rendering**: React Server Components (RSC) for pages, Client Components for interactive elements
- **API**: tRPC for type-safe RPC, SSE routes for streaming
- **Auth/State**: NextAuth.js if needed later, no Context/useState for data
- **DB**: Prisma ORM with SQLite (same DB, accessed by both layers)

### Python Worker — Agent Layer
- **Decomposition**: `meta_scheduler.py` — LLM-powered task breakdown
- **Execution**: `orchestrator.py` — parallel agent dispatch
- **Tools**: web search, code execution, file I/O
- **Events**: SSE endpoint for real-time agent status
- **Checkpoints**: `state_manager.py` — resume from failure

## What We Keep (from current agent_swarm/)
| File | Status | Notes |
|------|--------|-------|
| `orchestrator.py` | Keep, thin wrap | Add SSE endpoint, remove `_push_event` |
| `meta_scheduler.py` | Keep | No changes needed |
| `models.py` | Keep | Pydantic models stay |
| `agent_factory.py` | Keep | No changes |
| `state_manager.py` | Keep | No changes |
| `judge.py` | Keep | Quality evaluation |
| `context.py` | Keep | Context compression |
| `budget.py` | Keep | Token tracking |
| `exceptions.py` | Keep | Custom exceptions |
| `trace.py` | Keep | Execution tracing |
| `infrastructure/` | Keep | LLM client, tool registry |
| `prompts/` | Keep | Decomposer prompts |

## What We Delete
| Path | Reason |
|------|--------|
| `backend/server.py` (570 lines) | Replaced by Next.js API + tRPC |
| `backend/storage.py` | Replaced by Prisma |
| `backend/task_executor.py` | Event emission moves to Python worker SSE |
| `backend/ws_manager.py` | Replaced by Next.js SSE ReadableStream |
| `frontend/` (entire directory) | Full React rewrite to Next.js |
| `scripts/generate_types.py` | tRPC auto-derives types, no generation needed |
| `tests/test_server.py` (SSE portions) | Rewritten for tRPC test caller |
| `tests/test_sse_integration.py` | Rewritten for Python worker SSE + Next.js SSE |
| `tests/test_ws_manager.py` | Not needed (WS replaced by SSE) |
| `tests/test_ws_integration.py` | Not needed |

## New Files (Next.js)
```
agent-swarm-v2/
├── next.config.js
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── prisma/
│   └── schema.prisma          # Conversation, Message, Task, AgentResult
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout + Tailwind
│   │   ├── page.tsx            # Home: conversation list + chat
│   │   └── api/
│   │       ├── trpc/[trpc].ts  # tRPC handler
│   │       └── task/[id]/stream/route.ts  # SSE endpoint
│   ├── server/
│   │   ├── trpc.ts             # tRPC server init
│   │   ├── routers/
│   │   │   ├── conversation.ts # CRUD
│   │   │   ├── task.ts         # Submit/cancel/status
│   │   │   ├── settings.ts     # LLM config
│   │   │   └── workspace.ts    # File browse + upload
│   │   └── python.ts           # HTTP client to Python worker
│   ├── components/
│   │   ├── Chat.tsx            # Message list (Client Component, minimal state)
│   │   ├── AgentStatus.tsx     # Agent tracker (Client Component, SSE consumption)
│   │   ├── InputBar.tsx        # Query input (Client Component)
│   │   ├── Sidebar.tsx         # Conversation list (Server Component)
│   │   └── ui/                 # shadcn/ui primitives
│   ├── lib/
│   │   ├── prisma.ts           # Singleton Prisma client
│   │   └── utils.ts
│   └── types/
│       └── index.ts            # Shared types (Zod schemas → inferred TS types)
├── agent_swarm/                # Python core (copied, mostly unchanged)
│   └── worker.py               # NEW: FastAPI wrapper for Next.js to call
└── tests/
    ├── test_trpc.ts            # tRPC integration tests
    └── test_e2e.ts             # Playwright end-to-end tests
```

## Migration Phases

### Phase 1: Scaffold Next.js App (Day 1)
- `npx create-next-app@latest agent-swarm-v2`
- Install: `@prisma/client`, `@trpc/server`, `@trpc/client`, `tailwindcss`, `shadcn/ui`
- Copy `agent_swarm/` from v1
- Create Prisma schema (conversations, messages, tasks, agent_results)
- Run `prisma db push`
- Verify: `npm run dev` shows empty app

### Phase 2: Python Worker (Day 1-2)
- Create `agent_swarm/worker.py` — FastAPI app wrapping orchestrator
- Endpoints: `POST /decompose`, `POST /execute`, `POST /cancel`, `GET /events/{task_id}`
- Use SSE (`StreamingResponse`) for agent events
- Remove `_push_event`, `_streams`, `manager.broadcast` — just yield to SSE
- Verify: `python worker.py` + `curl POST /decompose` returns DAG

### Phase 3: tRPC API Routes (Day 2-3)
- Create tRPC routers for conversations, tasks, settings, workspace
- Zod schemas for all inputs/outputs (auto-derive TS types)
- `POST /api/trpc/task.submit` → calls Python worker `/execute`
- `POST /api/trpc/task.cancel` → calls Python worker `/cancel`
- Verify: tRPC playground at `/api/trpc`

### Phase 4: SSE Streaming (Day 3)
- Next.js `api/task/[id]/stream/route.ts` → Web Streams API
- Pipes Python worker SSE events to browser
- Auto-reconnect via `EventSource` (browser native, zero code)
- No manual connection management, no heartbeat, no reconnect logic
- Verify: `curl /api/task/xxx/stream` → SSE events

### Phase 5: Frontend Components (Day 3-5)
- `Chat.tsx` — Server Component renders messages, Client hydrates for SSE
- `AgentStatus.tsx` — Client Component consumes SSE, shows agent tracker
- `InputBar.tsx` — Client Component, calls `trpc.task.submit`
- `Sidebar.tsx` — Server Component, fetches conversations via Prisma
- `settings/page.tsx` — Server Component for config
- `workspace/page.tsx` — Server Component for file browser
- shadcn/ui for all UI primitives (buttons, inputs, dialogs)

### Phase 6: Testing (Day 5-6)
- tRPC integration tests (no HTTP, direct caller)
- Python worker unit tests (keep existing, update for new interface)
- Playwright E2E tests (submit task → see agents → verify output)

### Phase 7: Cleanup & Deploy (Day 6)
- Delete v1 codebase
- `next build` + `next start`
- Single `docker-compose.yml` with Next.js + Python worker

## Key Improvements Over v1

| v1 | v2 |
|---|---|
| 570-line server.py | ~30 lines per API route |
| 4 React Contexts | 1-2 minimal Client Components, rest RSC |
| `generate_types.py` script | tRPC auto-derives types from Zod |
| WebSocket manual reconnect/retry | SSE browser-native reconnect |
| `raw as WSEvent` cast | tRPC compile-time type safety |
| `ConvContext as any._stateRef` | No Context needed at all |
| FastAPI + vite dev server (2 processes) | `next dev` (1 process) + Python worker |
| tmux manual process management | Next.js built-in process manager |

## Estimated Timeline
- **Total**: 5-6 days
- **Lines deleted**: ~4000 (backend/ + frontend/ + WS manager + task_executor)
- **Lines added**: ~2000 (Next.js app + worker.py + tRPC routers)
- **Net**: ~2000 lines less code, significantly simpler architecture
