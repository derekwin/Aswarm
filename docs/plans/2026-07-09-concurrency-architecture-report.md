# AgentSwarm 并发架构报告

> 日期: 2026-07-09 | 版本: 0.1.0

## 1. 并发模型概述

AgentSwarm 的并发模型基于 Python `asyncio`，采用 **单进程事件循环 + 协程并发** 模式。

```
FastAPI (uvicorn)
  └── asyncio event loop
        ├── HTTP workers (per-request coroutines)
        ├── WebSocket connections (per-connection coroutines)
        ├── Task executors (per-task coroutines via asyncio.create_task)
        │     └── SwarmOrchestrator
        │           └── Parallel group execution (asyncio.gather)
        │                 ├── Agent A coroutine
        │                 ├── Agent B coroutine
        │                 └── Agent C coroutine
        └── Periodic sync (background coroutine, 5-min interval)
```

## 2. 关键并发路径

### 2.1 任务执行 (`task_executor.py`)

```python
# server.py — fire-and-forget task execution
asyncio.create_task(_execute_task(task_id, conv_id, query, lang))

# orchestrator.py — parallel agent execution within a group
batch_results = await asyncio.gather(
    *(t[1] for t in batch)
)
```

**并发度分析**:
- 每个任务独立运行在一个 `asyncio.create_task` 创建的协程中
- 同一组内的 agent 通过 `asyncio.gather` 并行执行
- 不同组的 agent 串行执行（按 `parallel_groups` 顺序）
- LLM API 调用是真正的 I/O 操作，`asyncio` 在等待 HTTP 响应时会释放事件循环

### 2.2 WebSocket 广播 (`ws_manager.py`)

```python
async def broadcast(self, task_id: str, event: dict):
    for ws in subs:
        try:
            await ws.send_json(event)  # 串行发送！
        except Exception:
            dead.append(ws)
```

**问题**: 广播是串行的 — 如果有 10 个订阅者，第 1 个慢速客户端会阻塞第 2-10 个的消息。

**建议**: 改为 `asyncio.gather` 并行发送。

### 2.3 事件推送 (`server.py`)

```python
def _push_event(task_id: str, event: dict):
    event["task_id"] = task_id
    asyncio.create_task(manager.broadcast(task_id, event))
```

**问题**: 每次事件创建一个新的 `asyncio.Task`。每秒数百个事件时（如高频 tool_call），会创建大量任务。

**建议**: 当事件频率超过阈值时，考虑批量合并事件。

## 3. 共享状态与竞态条件

### 3.1 `_cancel_flags` (dict)

- **写入**: HTTP cancel 端点、WS cancel action
- **读取**: orchestrator 的 `is_cancelled` lambda（在 agent 执行循环中检查）
- **风险**: Python GIL 确保了 dict 操作的原子性，`dict.get/set` 在 CPython 中是线程安全的
- **评估**: 低风险 — 单进程 asyncio，无真正的并行写入

### 3.2 `_approval_events` (dict) / `_approval_decisions` (dict)

- **写入**: HTTP approve 端点
- **读取**: `wait_for_approval` 协程
- **风险**: approve 端点设置 `_approval_decisions` 后立即 `evt.set()`，而 `wait_for_approval` 在 `evt.wait()` 返回后读取。顺序正确。
- **评估**: 低风险

### 3.3 `manager.subscriptions` (dict of sets)

- **写入**: subscribe / unsubscribe / disconnect
- **读取**: broadcast（遍历 subscribers）
- **风险**: subscribe 在 `broadcast` 遍历期间修改 set 可能导致 RuntimeError
  ```
  for ws in subs:           # 正在遍历
      await ws.send_json()  # 如果此协程被挂起...
  # 另一个协程: subs.discard(ws)  # 修改了 set
  ```
- **评估**: 中等风险。在当前模式下，subscribe/unsubscribe 来自同一个 WebSocket 连接的事件循环，不会与 broadcast 交错 —— 因为 subscribe 消息处理和 broadcast 都在同一个事件循环中，且 subscribe 不包含 `await` 点。但如果将来从多个连接并发 subscribe，会有问题。

## 4. 资源泄漏风险

| 资源 | 清理机制 | 风险评估 |
|------|---------|---------|
| `_cancel_flags` keys | finally 清理 + 5-min 定期清理 | ✅ 低 |
| `_approval_events` keys | finally 清理 + 定期清理 | ✅ 低 |
| WebSocket subscriptions | disconnect 清理 | ✅ 低 |
| Event archive per task | cleanup() 30s after task end | ✅ 低 |
| `asyncio.create_task` tasks | 任务完成后自动清理 | ⚠️ 中 — 无取消机制 |
| Memory (messages) | MAX_MESSAGES=500 | ✅ 低 |

## 5. 性能瓶颈

### 5.1 "Time to First Token" (TTFT)

TTFT = HTTP 延迟 + 任务分解 (LLM 调用) + 第一个 agent_start 事件

- **HTTP**: `asyncio.create_task` fire-and-forget，`/run` 立即返回 task_id → ~5ms
- **分解**: MetaScheduler LLM 调用 → 取决于模型和 query 复杂度 → 2-10s
- **首事件**: agent_start 通过 WS 推送 → ~1ms

**瓶颈在 LLM 调用**，不在并发模型。

### 5.2 WAL 模式 SQLite

```python
await self._conn.execute("PRAGMA journal_mode=WAL")
```

WAL 模式允许多个读操作与一个写操作并发，适合 asyncio 场景。但 SQLite 仍然是单写入者，高频写入 `store_dag_data` / `add_agent_result` 会排队。

## 6. 改进建议（优先级排序）

| 优先级 | 项目 | 工作量 |
|--------|------|--------|
| P0 | WS broadcast 并行化（asyncio.gather） | 1h |
| P1 | `_push_event` 高频事件批量合并 | 3h |
| P1 | subscriptions 并发安全（添加 asyncio.Lock） | 2h |
| P2 | asyncio.create_task 取消管理（task registry + cancel_all） | 4h |
| P2 | SQLite 连接池（多读单写） | 4h |
| P3 | 多进程部署（gunicorn + uvicorn workers） | 1d |

## 7. 当前适用场景

当前架构适合:
- 单用户或少量并发用户（<50 活跃 WS 连接）
- 任务时长数十秒到数分钟
- 每个任务 2-10 个 agent

不适合:
- 数百并发用户
- 毫秒级延迟要求
- 跨进程状态共享
