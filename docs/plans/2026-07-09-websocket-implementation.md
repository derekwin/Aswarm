# WebSocket 替换 SSE 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用单条 WebSocket 连接替换多 SSE EventSource 连接，实现所有会话的统一事件管理和可靠重连。

**Architecture:** 后端新增 `ConnectionManager` 管理 WS 连接与任务订阅关系；前端新增 `WebSocketContext` 全局单例 + `useWebSocket` hook；`useTaskRunner` 删除 EventSource 和 REST 轮询逻辑，改为调用 WebSocket。

**Tech Stack:** Python FastAPI WebSocket, TypeScript native WebSocket API, React Context

---

### Task 1: 新建 ConnectionManager

**Files:**
- Create: `backend/ws_manager.py`
- Test: `tests/test_ws_manager.py`

**Step 1: 编写 ConnectionManager 类**

```python
# backend/ws_manager.py
"""WebSocket connection manager with task-based subscription support."""

import json
import logging
from fastapi import WebSocket

logger = logging.getLogger(__name__)

MAX_ARCHIVE = 100


class ConnectionManager:
    def __init__(self):
        self.subscriptions: dict[str, set[WebSocket]] = {}  # task_id → {ws...}
        self._event_archive: dict[str, list[dict]] = {}      # task_id → [...] , circular
        self._event_ids: dict[str, int] = {}                 # task_id → counter
        self._dag_snapshots: dict[str, dict] = {}            # task_id → dag snapshot

    # ── connection lifecycle ──

    async def connect(self, ws: WebSocket):
        await ws.accept()
        logger.info("WebSocket connected")

    async def disconnect(self, ws: WebSocket):
        for task_id, subs in list(self.subscriptions.items()):
            subs.discard(ws)
            if not subs:
                del self.subscriptions[task_id]
        logger.info("WebSocket disconnected, subscriptions cleaned")

    # ── subscription management ──

    async def subscribe(self, ws: WebSocket, task_id: str):
        if task_id not in self.subscriptions:
            self.subscriptions[task_id] = set()
        self.subscriptions[task_id].add(ws)

        # push dag snapshot first
        snap = self._dag_snapshots.get(task_id)
        if snap:
            await ws.send_json(snap)

        # replay archived events
        archive = self._event_archive.get(task_id, [])
        for evt in archive:
            await ws.send_json(evt)

        # signal catchup complete
        await ws.send_json({"type": "catchup_done", "task_id": task_id})
        logger.info(f"Client subscribed to {task_id}, replayed {len(archive)} events")

    async def unsubscribe(self, ws: WebSocket, task_id: str):
        if task_id in self.subscriptions:
            self.subscriptions[task_id].discard(ws)
            if not self.subscriptions[task_id]:
                del self.subscriptions[task_id]

    # ── broadcast ──

    def _next_event_id(self, task_id: str) -> int:
        self._event_ids[task_id] = self._event_ids.get(task_id, 0) + 1
        return self._event_ids[task_id]

    async def broadcast(self, task_id: str, event: dict):
        event["event_id"] = self._next_event_id(task_id)

        # archive
        if task_id not in self._event_archive:
            self._event_archive[task_id] = []
        archive = self._event_archive[task_id]
        archive.append(event)
        if len(archive) > MAX_ARCHIVE:
            archive[:] = archive[-MAX_ARCHIVE:]

        # push to subscribers
        subs = self.subscriptions.get(task_id, set())
        dead: list[WebSocket] = []
        for ws in subs:
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            subs.discard(ws)

    async def broadcast_all(self, event: dict):
        """Broadcast to all connected clients regardless of subscription."""
        seen: set[WebSocket] = set()
        for subs in self.subscriptions.values():
            for ws in subs:
                if ws not in seen:
                    seen.add(ws)
                    try:
                        await ws.send_json(event)
                    except Exception:
                        pass

    # ── snapshots ──

    def store_dag_snapshot(self, task_id: str, snapshot: dict):
        self._dag_snapshots[task_id] = snapshot

    def cleanup(self, task_id: str):
        self._event_archive.pop(task_id, None)
        self._event_ids.pop(task_id, None)
        self._dag_snapshots.pop(task_id, None)
```

**Step 2: 编写测试**

```python
# tests/test_ws_manager.py
import pytest
from backend.ws_manager import ConnectionManager


class MockWebSocket:
    def __init__(self):
        self.sent: list[dict] = []
        self.accepted = False

    async def accept(self):
        self.accepted = True

    async def send_json(self, data: dict):
        self.sent.append(data)


@pytest.mark.asyncio
async def test_connect_accepts():
    mgr = ConnectionManager()
    ws = MockWebSocket()
    await mgr.connect(ws)
    assert ws.accepted


@pytest.mark.asyncio
async def test_subscribe_replays_archive():
    mgr = ConnectionManager()
    ws = MockWebSocket()

    await mgr.broadcast("task_1", {"type": "agent_start", "task_id": "task_1", "subtask_id": "s1"})

    await mgr.subscribe(ws, "task_1")

    assert len(ws.sent) >= 2  # archive event + catchup_done
    assert ws.sent[-1]["type"] == "catchup_done"


@pytest.mark.asyncio
async def test_unsubscribe_removes_client():
    mgr = ConnectionManager()
    ws = MockWebSocket()

    await mgr.subscribe(ws, "task_1")
    await mgr.unsubscribe(ws, "task_1")

    assert "task_1" not in mgr.subscriptions


@pytest.mark.asyncio
async def test_broadcast_to_multiple_subscribers():
    mgr = ConnectionManager()
    ws1 = MockWebSocket()
    ws2 = MockWebSocket()

    await mgr.subscribe(ws1, "task_1")
    await mgr.subscribe(ws2, "task_1")

    await mgr.broadcast("task_1", {"type": "progress", "task_id": "task_1", "completed": 1, "total": 4})

    # Both should get the event (plus catchup_done from subscribe)
    assert any(e.get("type") == "progress" for e in ws1.sent)
    assert any(e.get("type") == "progress" for e in ws2.sent)


@pytest.mark.asyncio
async def test_event_id_increments():
    mgr = ConnectionManager()
    ws = MockWebSocket()

    await mgr.broadcast("task_1", {"type": "status", "task_id": "task_1"})
    await mgr.broadcast("task_1", {"type": "status", "task_id": "task_1"})

    await mgr.subscribe(ws, "task_1")

    events = [e for e in ws.sent if e.get("type") == "status"]
    assert len(events) == 2
    assert events[0]["event_id"] == 1
    assert events[1]["event_id"] == 2


@pytest.mark.asyncio
async def test_disconnect_cleans_subscriptions():
    mgr = ConnectionManager()
    ws = MockWebSocket()

    await mgr.subscribe(ws, "task_1")
    await mgr.disconnect(ws)

    assert "task_1" not in mgr.subscriptions
```

**Step 3: 运行测试验证**

```bash
python -m pytest tests/test_ws_manager.py -v
```

Expected: 6 passed

---

### Task 2: 后端 server.py 接入 WebSocket

**Files:**
- Modify: `backend/server.py`

**Step 1: 在 server.py 顶部引入 ConnectionManager**

找到 SSE 相关的全局变量声明（`_streams`、`_event_archive` 等），替换为：

```python
from backend.ws_manager import ConnectionManager

manager = ConnectionManager()
# _event_archive 和 _dag_snapshots 移到 manager 内部，删除以下：
# _streams: dict[str, asyncio.Queue] = {}       # DELETE
# _event_archive: dict[str, list[dict]] = {}      # DELETE
# _MAX_ARCHIVE = 100                              # DELETE (moved to ws_manager)
# _event_ids: dict[str, int] = {}                 # DELETE (moved to ws_manager)
```

**Step 2: 替换 _push_event**

```python
# OLD (DELETE):
def _push_event(task_id: str, event: dict):
    q = _streams.get(task_id)
    if q:
        _event_ids[task_id] = _event_ids.get(task_id, 0) + 1
        event["event_id"] = _event_ids[task_id]
        q.put_nowait(event)
        if task_id not in _event_archive:
            _event_archive[task_id] = []
        archive = _event_archive[task_id]
        archive.append(event)
        if len(archive) > _MAX_ARCHIVE:
            archive[:] = archive[-_MAX_ARCHIVE:]

# NEW:
def _push_event(task_id: str, event: dict):
    """Queue event for broadcasting via WebSocket. Runs in background."""
    asyncio.create_task(manager.broadcast(task_id, event))
```

**Step 3: 添加 /ws 端点，删除 /stream/{task_id}**

```python
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
```

**Step 4: 删除 /stream/{task_id} 端点（整个路由 + event_gen + _event_stream_empty）**

删除范围：从 `@app.get("/stream/{task_id}")` 到对应的函数结束（约 80 行）。

**Step 5: 更新 dag snapshot 存储方式**

找到 `_dag_snapshots[task_id] = ...`，改为：

```python
manager.store_dag_snapshot(task_id, snapshot)
```

**Step 6: 更新 task cleanup**

找到 `_event_archive.pop(task_id, None)` 等清理代码，改为：

```python
manager.cleanup(task_id)
```

**Step 7: 运行后端测试**

```bash
python -m pytest tests/ -v -x --ignore=tests/test_frontend --ignore=tests/test_ws_manager.py
```

Expected: 所有已有后端测试通过，无 SSE 相关 import 错误。

---

### Task 3: 新建前端 WebSocket Context

**Files:**
- Create: `frontend/src/context/WebSocketContext.tsx`

```tsx
// frontend/src/context/WebSocketContext.tsx
import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';

type WSEventHandler = (event: Record<string, unknown>) => void;

interface WebSocketContextValue {
  connected: boolean;
  subscribe: (taskId: string) => void;
  unsubscribe: (taskId: string) => void;
  cancel: (taskId: string) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];
const PING_INTERVAL = 30000;
const PONG_TIMEOUT = 60000;

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, WSEventHandler>>(new Map());
  const subscribedRef = useRef<Set<string>>(new Set());
  const reconnectAttemptRef = useRef(0);
  const pingTimerRef = useRef<ReturnType<typeof setInterval>>();
  const pongTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const intentionalCloseRef = useRef(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptRef.current = 0;

      // Resubscribe all active tasks
      for (const taskId of subscribedRef.current) {
        ws.send(JSON.stringify({ action: 'subscribe', task_id: taskId }));
      }

      // Start heartbeat
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'ping' }));
          pongTimerRef.current = setTimeout(() => {
            ws.close();
          }, PONG_TIMEOUT);
        }
      }, PING_INTERVAL);
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        // Reset pong timer
        if (data.type === 'pong') {
          clearTimeout(pongTimerRef.current);
          return;
        }

        // Route event to task handler
        const taskId = data.task_id as string;
        if (taskId) {
          const handler = handlersRef.current.get(taskId);
          if (handler) handler(data);
        }
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      setConnected(false);
      clearInterval(pingTimerRef.current);
      clearTimeout(pongTimerRef.current);

      if (intentionalCloseRef.current) return;

      const delay = RECONNECT_DELAYS[Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)];
      reconnectAttemptRef.current++;
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      intentionalCloseRef.current = true;
      wsRef.current?.close();
      clearInterval(pingTimerRef.current);
      clearTimeout(pongTimerRef.current);
    };
  }, [connect]);

  const subscribe = useCallback((taskId: string) => {
    subscribedRef.current.add(taskId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'subscribe', task_id: taskId }));
    }
  }, []);

  const unsubscribe = useCallback((taskId: string) => {
    subscribedRef.current.delete(taskId);
    handlersRef.current.delete(taskId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'unsubscribe', task_id: taskId }));
    }
  }, []);

  const cancel = useCallback((taskId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'cancel', task_id: taskId }));
    }
  }, []);

  return (
    <WebSocketContext.Provider value={{ connected, subscribe, unsubscribe, cancel }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used within WebSocketProvider');
  return ctx;
}
```

**Step 1: 运行前端 build**

```bash
cd frontend && npm run build
```

Expected: build 成功

---

### Task 4: 重构 useTaskRunner 使用 WebSocket

**Files:**
- Modify: `frontend/src/hooks/useTaskRunner.ts`

**Step 1: 删除 EventSource 相关逻辑**

删除以下所有代码：
- `eventSourceRef`、`connectSSERef`、`lastEventIdRef` — EventSource refs
- `handleSSEEvent` → 重命名为 `handleWSEvent`，签名改为 `(event: Record<string, unknown>) => void`
- `connectSSE` 整个函数
- `useEffect(() => { connectSSERef.current = connectSSE; }, [connectSSE])`
- `useEffect(() => { return () => { eventSourceRef.current?.close(); }; }, [])`
- `es.onerror` 中的 REST 轮询逻辑（`let pollActive = true; ...` 整个代码块）
- `reconnect` 函数中 `eventSourceRef.current?.readyState !== EventSource.CLOSED` 判断

**Step 2: 集成 useWebSocket**

```typescript
import { useWebSocket } from '@/context/WebSocketContext';

export function useTaskRunner() {
  const { state: conv, dispatch: convDispatch } = useConv();
  const { state: ui, dispatch: uiDispatch } = useUI();
  const { subscribe, cancel } = useWebSocket();
  const t = useT();
  const taskIdRef = useRef<string | null>(null);
  const convIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<Record<string, number>>({});

  // handleWSEvent: same logic as old handleSSEEvent, no EventSource arg needed
  const handleWSEvent = useCallback((event: Record<string, unknown>) => {
    const d = event as SSEEvent; // reuse existing types, now includes task_id
    switch (d.type) {
      case 'catchup_done':
        break;
      case 'status':
        convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: d.msg } });
        break;
      // ... all existing cases unchanged except remove `es` arg from `done` handler
      case 'done':
        uiDispatch({ type: 'SET_CONNECTED', payload: false });
        if (d.summary) convDispatch({ type: 'APPEND_MSG', payload: { role: 'assistant', content: d.summary } });
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'completed' });
        break;
      // ... rest unchanged
    }
  }, [convDispatch, uiDispatch, t]);

  const runTask = useCallback(async (convId: string, query: string) => {
    convDispatch({ type: 'APPEND_MSG', payload: { role: 'user', content: query } });
    convDispatch({ type: 'APPEND_MSG', payload: { role: 'assistant', content: t('decomposing'), typing: true } });
    convDispatch({ type: 'SET_EXEC_STATE', payload: 'connecting' });
    convIdRef.current = convId;

    try {
      const { task_id } = await api.runTask(query, convId, ui.lang);
      convDispatch({ type: 'SET_TASK_ID', payload: task_id });
      taskIdRef.current = task_id;
      uiDispatch({ type: 'SET_CONNECTED', payload: true });
      subscribe(task_id); // replaces connectSSE(task_id)
    } catch {
      uiDispatch({ type: 'SET_CONNECTED', payload: false });
      convDispatch({ type: 'SET_EXEC_STATE', payload: 'failed' });
      convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: t('loadError'), typing: false } });
    }
  }, [convDispatch, uiDispatch, subscribe, t]);

  const cancelTask = useCallback(async () => {
    const tid = taskIdRef.current;
    if (tid) {
      cancel(tid); // replaces HTTP cancel + EventSource close
      uiDispatch({ type: 'SET_CONNECTED', payload: false });
      convDispatch({ type: 'SET_EXEC_STATE', payload: 'cancelled' });
      convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: t('cancelled'), typing: false } });
    }
  }, [cancel, convDispatch, uiDispatch, t]);

  const cleanupRefs = useCallback(() => {
    convIdRef.current = null;
    taskIdRef.current = null;
  }, []);

  return { runTask, cancelTask, cleanupRefs };
}
```

**注意**: `handleWSEvent` 回调需要注册到 WebSocketContext。在 App.tsx 初始化时通过 `useEffect` 注册。

**Step 3: 运行前端测试**

```bash
cd frontend && npm test -- --run
```

Expected: 测试通过，useTaskRunner 相关测试需根据新接口调整。

---

### Task 5: App.tsx 接入 WebSocketProvider 和事件注册

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: 包裹 WebSocketProvider**

```tsx
import { WebSocketProvider } from '@/context/WebSocketContext';

// In main render:
<WebSocketProvider>
  <ConvProvider>
    {/* existing app content */}
  </ConvProvider>
</WebSocketProvider>
```

**Step 2: 在 App.tsx 中注册 handleWSEvent**

```tsx
// In App component, after hooks:
const { handleWSEvent, runTask, cancelTask, connectSSE, reconnect, cleanupRefs } = useTaskRunner();

// handleWSEvent must be registered with WebSocketContext
// See Task 6 for the registration mechanism
```

---

### Task 6: 在 WebSocketContext 中添加事件处理器注册机制

**Files:**
- Modify: `frontend/src/context/WebSocketContext.tsx`

新增 `registerHandler` 方法：

```tsx
interface WebSocketContextValue {
  connected: boolean;
  subscribe: (taskId: string) => void;
  unsubscribe: (taskId: string) => void;
  cancel: (taskId: string) => void;
  registerHandler: (taskId: string, handler: WSEventHandler) => void;  // NEW
}

// In WebSocketProvider:
const registerHandler = useCallback((taskId: string, handler: WSEventHandler) => {
  handlersRef.current.set(taskId, handler);
}, []);
```

---

### Task 7: 更新 App.tsx reconnect 和 cache restore 逻辑

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: 替换 reconnect 函数**

旧的 `reconnect` 函数检查 `eventSourceRef` 并调用 `connectSSE`，改为：

```tsx
const reconnectTask = useCallback((taskId: string) => {
  subscribe(taskId);
}, [subscribe]);
```

**Step 2: 清理 cache restore 中的 EventSource 引用**

`App.tsx` 中 `if (status === 'running')` 分支调用了 `connectSSE(taskData.task.id, lastEventId)`，改为：

```tsx
subscribe(taskData.task.id);
```

删除 `lastEventId` 相关逻辑（不再需要，subscribe 自动补推全部历史）。

---

### Task 8: 清理无用代码和类型更新

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/types/api.ts`

**Step 1: 更新 SSEEvent 类型为 WSEvent**

在 `types/index.ts` 中新增 `task_id` 字段到所有事件类型：

```typescript
export type WSEvent =
  | { type: 'status'; task_id: string; msg: string; event_id: number }
  | { type: 'exec_state'; task_id: string; state: 'decomposing' | 'streaming' | 'completed' | 'failed'; event_id: number }
  | { type: 'dag'; task_id: string; intent: string; subtasks: SubtaskInfo[]; parallel_groups: string[][]; event_id: number }
  | { type: 'agent_start'; task_id: string; subtask_id: string; agent_name: string; role: string; event_id: number }
  | { type: 'agent_done'; task_id: string; subtask_id: string; state: string; output?: string; error?: string; retry_count: number; event_id: number }
  | { type: 'tool_call'; task_id: string; agent_name: string; tool: string; args: string; event_id: number }
  | { type: 'done'; task_id: string; summary?: string; results?: unknown[]; event_id: number }
  | { type: 'progress'; task_id: string; completed: number; total: number; event_id: number }
  | { type: 'error'; task_id: string; msg: string; code?: string; event_id: number }
  | { type: 'catchup_done'; task_id: string };
```

保留旧的 `SSEEvent` 类型（标记 `@deprecated`），逐步迁移。

---

### Task 9: 端到端测试

**Step 1: 启动后端**

```bash
python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000
```

**Step 2: 启动前端 dev server**

```bash
cd frontend && npm run dev
```

**Step 3: 手动测试场景**

1. 发起一个任务：访问 `http://localhost:5173`，输入查询，确认 agent 状态实时更新
2. 取消任务：任务运行中点停止按钮，确认 WS cancel 生效
3. 断连重连：关闭浏览器标签页 → 重新打开 → 确认 reconnect 正常
4. 多会话：创建两个对话，分别发起任务，确认事件不串台

**Step 4: 运行完整测试套件**

```bash
# Backend
python -m pytest tests/ -v

# Frontend
cd frontend && npm test -- --run && npm run build
```

---

### Task 10: 提交

```bash
git add backend/ws_manager.py tests/test_ws_manager.py backend/server.py \
       frontend/src/context/WebSocketContext.tsx frontend/src/hooks/useTaskRunner.ts \
       frontend/src/App.tsx frontend/src/types/index.ts frontend/src/types/api.ts
git commit -m "feat: replace SSE with WebSocket single-connection architecture"
```

---

## 改动文件清单

| 操作 | 文件 |
|------|------|
| Create | `backend/ws_manager.py` |
| Create | `tests/test_ws_manager.py` |
| Create | `frontend/src/context/WebSocketContext.tsx` |
| Modify | `backend/server.py` (删 ~80 行，改 ~20 行) |
| Modify | `frontend/src/hooks/useTaskRunner.ts` (删 ~90 行，改 ~30 行) |
| Modify | `frontend/src/App.tsx` (~10 行) |
| Modify | `frontend/src/types/index.ts` (~15 行) |

## 预计工作量

约 2-3 小时，主要集中在 ConnectionManager 和 WebSocketContext 的实现，以及 useTaskRunner 的 EventSource 剥离。
