"""WebSocket integration tests — subscribe, receive events, unsubscribe, reconnect."""

import pytest

from backend.ws_manager import ConnectionManager


class FakeWS:
    def __init__(self):
        self.sent: list[dict] = []
        self.accepted = False
    async def accept(self):
        self.accepted = True
    async def send_json(self, data: dict):
        self.sent.append(data)


@pytest.mark.asyncio
async def test_ws_manager_lifecycle():
    """ConnectionManager connect/disconnect/subscribe/unsubscribe does not crash."""
    mgr = ConnectionManager()
    ws = FakeWS()

    await mgr.connect(ws)
    assert ws.accepted

    await mgr.subscribe(ws, "task_test")
    assert "task_test" in mgr.subscriptions

    await mgr.broadcast("task_test", {"type": "status", "task_id": "task_test", "msg": "hello"})
    assert any(e.get("msg") == "hello" for e in ws.sent)

    await mgr.unsubscribe(ws, "task_test")
    assert "task_test" not in mgr.subscriptions

    await mgr.disconnect(ws)


@pytest.mark.asyncio
async def test_ws_broadcast_to_multiple():
    """Broadcast reaches all subscribers of a task, not others."""
    mgr = ConnectionManager()
    ws1, ws2, ws3 = FakeWS(), FakeWS(), FakeWS()

    await mgr.subscribe(ws1, "task_a")
    await mgr.subscribe(ws2, "task_a")
    await mgr.subscribe(ws3, "task_b")

    await mgr.broadcast("task_a", {"type": "status", "task_id": "task_a", "msg": "a"})

    assert any(e.get("msg") == "a" for e in ws1.sent)
    assert any(e.get("msg") == "a" for e in ws2.sent)
    assert not any(e.get("msg") == "a" for e in ws3.sent)


@pytest.mark.asyncio
async def test_ws_event_archive_replay():
    """Subscribe replays archived events then sends catchup_done."""
    mgr = ConnectionManager()
    receiver = FakeWS()

    await mgr.broadcast("task_1", {"type": "agent_start", "task_id": "task_1", "subtask_id": "s1"})
    await mgr.broadcast("task_1", {"type": "agent_done", "task_id": "task_1", "subtask_id": "s1", "state": "completed"})

    await mgr.subscribe(receiver, "task_1")

    types = [e.get("type") for e in receiver.sent]
    assert "agent_start" in types
    assert "agent_done" in types
    assert types[-1] == "catchup_done"


@pytest.mark.asyncio
async def test_ws_dag_snapshot_on_subscribe():
    """Subscribe replays DAG snapshot if one was stored."""
    mgr = ConnectionManager()
    mgr.store_dag_snapshot("task_1", {"type": "dag", "task_id": "task_1", "intent": "test"})

    ws = FakeWS()
    await mgr.subscribe(ws, "task_1")

    assert any(e.get("type") == "dag" for e in ws.sent)


@pytest.mark.asyncio
async def test_ws_cleanup_removes_task_data():
    """Cleanup removes archives, event IDs, and snapshots."""
    mgr = ConnectionManager()

    await mgr.broadcast("task_1", {"type": "status", "task_id": "task_1"})
    mgr.store_dag_snapshot("task_1", {"type": "dag", "task_id": "task_1"})

    assert "task_1" in mgr._event_archive
    assert "task_1" in mgr._event_ids
    assert "task_1" in mgr._dag_snapshots

    mgr.cleanup("task_1")

    assert "task_1" not in mgr._event_archive
    assert "task_1" not in mgr._event_ids
    assert "task_1" not in mgr._dag_snapshots


@pytest.mark.asyncio
async def test_ws_archive_circular_buffer():
    """Archive keeps only last MAX_ARCHIVE events."""
    mgr = ConnectionManager()

    for i in range(150):
        await mgr.broadcast("task_1", {"type": "status", "task_id": "task_1", "msg": str(i)})

    assert len(mgr._event_archive["task_1"]) == 100
    assert mgr._event_archive["task_1"][0]["msg"] == "50"
    assert mgr._event_archive["task_1"][-1]["msg"] == "149"
