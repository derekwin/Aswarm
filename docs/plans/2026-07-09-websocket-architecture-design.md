# WebSocket 替换 SSE — 架构设计

> 日期: 2026-07-09
> 状态: 已确认

## 背景

当前 AgentSwarm 使用 SSE (Server-Sent Events) 实现实时通信，每条任务一个 `EventSource` 连接，存在三个核心问题：

1. **多连接管理混乱** — N 个 task 需要 N 个 SSE 连接，前端需协调多个 `EventSource` 生命周期
2. **重连脆弱** — `EventSource.onerror` 不区分断开原因，重连依赖 REST 轮询兜底，`lastEventId` 依赖内存 archive
3. **单工限制** — 取消任务需额外 HTTP 请求，与事件流割裂

## 方案

**WebSocket 单连接多通道**：一条 WebSocket 连接承载所有会话的实时事件，客户端通过 subscribe/unsubscribe 管理感兴趣的任务，服务端按订阅关系广播。

### 核心变化

| 维度 | SSE (旧) | WebSocket (新) |
|------|---------|---------------|
| 连接模型 | 1 task = 1 EventSource | 全应用 1 条 WS 连接 |
| 重连策略 | 各自重连 + HTTP 轮询兜底 | 统一重连，重订阅后服务端补推 |
| 取消任务 | HTTP POST /cancel | WS 发 cancel action |
| 前端入口 | useTaskRunner 内 EventSource | React Context 全局单例 |
| 后端事件分发 | per-task asyncio.Queue | ConnectionManager 按订阅广播 |

## 架构图

```
┌─ 前端 (1 条 WS) ─────────┐     ┌─ 后端 /ws ────────────────────┐
│                            │     │                                │
│  WebSocketProvider         │     │  ConnectionManager             │
│  ├─ useWebSocket()         │◄───►│  ├─ subscriptions[task_id]    │
│  │  ├─ subscribe(t1) ──────│────►│  │    = {ws1, ws2}            │
│  │  ├─ subscribe(t2) ──────│────►│  ├─ connect(ws) → conn_id     │
│  │  ├─ cancel(t1) ─────────│────►│  ├─ disconnect(ws)            │
│  │  └─ onEvent → dispatch  │◄────│  │  ├─ subscribe(ws, task_id) │
│  ├─ 自动重连               │     │  │  │  └─ 补推历史事件        │
│  └─ 心跳 keepalive         │     │  │  └─ broadcast(task, event) │
│                            │     │                                │
│  useTaskRunner             │     │  EventArchive (已有)           │
│  ├─ runTask() → REST /run  │     │  └─ 保留，重连补推数据源      │
│  └─ handleWSEvent()        │     │                                │
└────────────────────────────┘     └────────────────────────────────┘
```

## 协议设计

### 客户端 → 服务端

```json
{"action": "subscribe",   "task_id": "task_xxx"}
{"action": "unsubscribe", "task_id": "task_xxx"}
{"action": "cancel",      "task_id": "task_xxx"}
{"action": "ping"}
```

### 服务端 → 客户端

```json
{"type": "exec_state",   "task_id": "t1", "state": "streaming", "event_id": 1}
{"type": "dag",          "task_id": "t1", "intent": "research", "subtasks": [...], "parallel_groups": [...], "event_id": 2}
{"type": "agent_start",  "task_id": "t1", "subtask_id": "s1", "agent_name": "...", "role": "...", "event_id": 3}
{"type": "agent_done",   "task_id": "t1", "subtask_id": "s1", "state": "completed", "output": "...", "event_id": 4}
{"type": "tool_call",    "task_id": "t1", "agent_name": "...", "tool": "webfetch", "args": "...", "event_id": 5}
{"type": "progress",     "task_id": "t1", "completed": 2, "total": 4, "event_id": 6}
{"type": "done",         "task_id": "t1", "summary": "...", "event_id": 7}
{"type": "error",        "task_id": "t1", "msg": "...", "code": "TIMEOUT", "event_id": 8}
{"type": "catchup_done", "task_id": "t1"}
{"type": "pong"}
```

### 重连补推

1. WS 断连 → 自动重连（指数退避）
2. 重连成功后，对每个活跃 task 发送 `subscribe`
3. 服务端从 `EventArchive` 读取全部历史事件并推送
4. 推送完毕后发 `catchup_done`，客户端开始接收实时事件

## 组件设计

### 后端新增

**`backend/ws_manager.py`** — ConnectionManager

```python
class ConnectionManager:
    subscriptions: dict[str, set[WebSocket]]  # task_id → 订阅者集合

    async def connect(ws: WebSocket) → str          # 接受连接，返回 conn_id
    async def disconnect(ws: WebSocket)              # 断连，清理订阅关系
    async def subscribe(ws: WebSocket, task_id: str) # 订阅 + 补推历史
    async def unsubscribe(ws: WebSocket, task_id: str)
    async def broadcast(task_id: str, event: dict)   # 广播给所有订阅者
```

### 后端删除

- `_streams: dict[str, asyncio.Queue]` — per-task 队列
- `/stream/{task_id}` SSE 端点
- `_event_stream_empty()` 函数
- `_event_ids` 全局计数器（改为 ConnectionManager 内部维护）

### 后端保留

- `_event_archive` — 重连补推数据源
- `_dag_snapshots` — subscribe 时首次快照
- 所有 REST API 不动（`/run`、`/conversations`、`/settings` 等）
- `_push_event` 改为调用 `manager.broadcast()`
- HTTP `/cancel` 端点保留（兼容非 WS 调用），WS cancel 为推荐路径

### 前端新增

**`frontend/src/context/WebSocketContext.tsx`** — 全局 WS 单例

```typescript
interface WebSocketContextValue {
  connected: boolean;
  subscribe(taskId: string): void;
  unsubscribe(taskId: string): void;
  cancel(taskId: string): void;
  onEvent: (handler: (event: WSEvent) => void) => () => void; // 返回取消订阅函数
}
```

**`frontend/src/hooks/useWebSocket.ts`** — WS 连接管理

- 自动重连：指数退避 1→2→4→8→16s
- 心跳：30s ping，60s 无 pong 视为断连
- 重连后自动重新 subscribe 所有活跃 task
- 消息分发：根据 `task_id` 调用已注册的 handler

### 前端修改

**`useTaskRunner.ts`** — 简化

- 删除 `EventSource` 逻辑（`eventSourceRef`、`connectSSE`、`connectSSERef`）
- 删除 REST 轮询兜底
- `runTask()` — 调 REST `/run` 后调用 `subscribe(task_id)`
- `handleSSEEvent` → `handleWSEvent`，逻辑不变
- `cancelTask()` — 改为调用 `ws.cancel(task_id)`

### 前端删除

- `useTaskRunner.ts` 中所有 EventSource 相关代码（~60 行）
- `useTaskRunner.ts` 中 REST 轮询逻辑（~30 行）

## 事件类型

```typescript
type WSEvent =
  | { type: 'exec_state'; task_id: string; state: TaskExecState; event_id: number }
  | { type: 'dag'; task_id: string; intent: string; subtasks: SubtaskInfo[]; parallel_groups: string[][]; event_id: number }
  | { type: 'agent_start'; task_id: string; subtask_id: string; agent_name: string; role: string; event_id: number }
  | { type: 'agent_done'; task_id: string; subtask_id: string; state: string; output?: string; error?: string; retry_count: number; event_id: number }
  | { type: 'tool_call'; task_id: string; agent_name: string; tool: string; args: string; event_id: number }
  | { type: 'progress'; task_id: string; completed: number; total: number; event_id: number }
  | { type: 'done'; task_id: string; summary?: string; event_id: number }
  | { type: 'error'; task_id: string; msg: string; code?: string; event_id: number }
  | { type: 'catchup_done'; task_id: string }
  | { type: 'pong' }
  | { type: 'status'; task_id: string; msg: string; event_id: number };
```

## 风险评估

| 风险 | 缓解 |
|------|------|
| WS 断连时丢失事件 | EventArchive 重连补推 |
| 服务重启后 archive 清空 | 通过 REST `/api/conversations/{id}/task` 获取最终状态兜底（已有） |
| 单连接承载所有任务，压力集中 | 前端只订阅当前会话，不订阅历史会话 |
| WS 长连接资源占用 | FastAPI + uvicorn 原生支持，无额外开销 |
