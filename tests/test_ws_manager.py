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

    assert len(ws.sent) >= 2
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
