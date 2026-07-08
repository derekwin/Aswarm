# State Management System Refactoring Plan

## Design Principles
1. **Backend is authoritative** — all state originates from backend; frontend is a view
2. **localStorage = UI continuity cache** — never a data source; 5min TTL, auto-cleanup
3. **Cache → API → SSE** — three-phase recovery: instant UI, then incremental sync, then real-time
4. **Event ordering** — SSE events carry sequence numbers for dedup and gap detection

## Phase 1: State Machine + P0 Bug Fixes

### 1.1 Full State Transfer Matrix
```
idle → connecting | completed | failed
connecting → decomposing | cancelled | failed
decomposing → streaming | cancelled | failed
streaming → completed | failed | cancelled | reconnecting
reconnecting → streaming | completed | failed
completed → ∅ (terminal, session switch resets to idle)
failed → connecting
cancelled → connecting
```

### 1.2 Files to Change
- `frontend/src/context/ConvContext.tsx` — `VALID_TRANSITIONS`, `transitionState`, `convReducer`
- `frontend/src/types/index.ts` — add `'reconnecting'` to `TaskExecState`
- `frontend/src/hooks/useTaskRunner.ts` — SSE guard by taskId, INCREMENT_COMPLETED dedup

## Phase 2: Backend Enhancements

### 2.1 Explicit `exec_state` SSE Event
- Replace `status` string matching with explicit `{ type: 'exec_state', state: 'decomposing' | 'streaming' }`
- Backend pushes `exec_state` event at deterministic lifecycle points

### 2.2 Event ID Sequence
- Every SSE event carries monotonic `event_id`
- Frontend tracks `lastEventId` and sends via `Last-Event-ID` on reconnect
- Server replays missed events from `_event_archive[task_id]` (circular buffer, last 100 events)

### 2.3 Granular Backend Status
- `tasks.status` gets intermediate states: `pending→running→completed|failed|cancelled`
- Server updates `tasks.status = 'running'` explicitly after DAG generation
- Agent results already stored per-agent (no change needed)

### 2.4 Files to Change
- `backend/server.py` — push `exec_state` events, add event archive, SSE Last-Event-ID handling
- `backend/storage.py` — add `update_task_progress()` if needed

## Phase 3: Incremental Sync Protocol

### 3.1 Recovery Flow
```
useLayoutEffect(convId)
  → Phase A: localStorage restore (instant, zero network)
  → Phase B: API getConversation + getRunningTask (parallel)
    → B1: Messages diff — append only new messages
    → B2: Agent diff — update only changed agents (state/output/error)
    → B3: Progress rebuild — recalculate from authoritative API data
  → Phase C: SSE reconnect (if task still running)
    → C1: Send Last-Event-ID for gap recovery
    → C2: On reconnect SSE ok → transition to streaming
    → C3: On reconnect fail → polling fallback

Synced event filter: skip SSE events with event_id <= lastSyncedEventId
```

### 3.2 Files to Change
- `frontend/src/App.tsx` — rewrite `useLayoutEffect` recovery
- `frontend/src/hooks/useTaskRunner.ts` — split into `useSSEConnection.ts` + restore logic
- Create `frontend/src/hooks/useStateRestore.ts`

## Phase 4: Tab Mutex + Offline Protection

### 4.1 Tab Isolation
- Each tab generates `TAB_ID = crypto.randomUUID()`
- localStorage writes only if `entry.tabId === TAB_ID`
- Other tabs read-only

### 4.2 Offline Protection
- `saveStateCache` checks `navigator.onLine` before writing
- Dispatches that would modify conversation state check online status

### 4.3 Files to Change
- `frontend/src/hooks/useTaskRunner.ts` — add TabId + offline checks
- `frontend/src/utils/storage.ts` — create cache utilities

## Execution Order
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Verify (Phase 5)
