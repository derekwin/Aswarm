"""WebSocket connection manager with task-based subscription support."""

import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)

MAX_ARCHIVE = 100


class ConnectionManager:
    def __init__(self):
        self.subscriptions: dict[str, set[WebSocket]] = {}
        self._event_archive: dict[str, list[dict]] = {}
        self._event_ids: dict[str, int] = {}
        self._dag_snapshots: dict[str, dict] = {}

    async def connect(self, ws: WebSocket):
        await ws.accept()
        logger.info("WebSocket connected")

    async def disconnect(self, ws: WebSocket):
        for task_id, subs in list(self.subscriptions.items()):
            subs.discard(ws)
            if not subs:
                del self.subscriptions[task_id]
        logger.info("WebSocket disconnected, subscriptions cleaned")

    async def subscribe(self, ws: WebSocket, task_id: str):
        if task_id not in self.subscriptions:
            self.subscriptions[task_id] = set()
        self.subscriptions[task_id].add(ws)

        snap = self._dag_snapshots.get(task_id)
        if snap:
            await ws.send_json(snap)

        archive = self._event_archive.get(task_id, [])
        for evt in archive:
            await ws.send_json(evt)

        await ws.send_json({"type": "catchup_done", "task_id": task_id})
        logger.info(f"Client subscribed to {task_id}, replayed {len(archive)} events")

    async def unsubscribe(self, ws: WebSocket, task_id: str):
        if task_id in self.subscriptions:
            self.subscriptions[task_id].discard(ws)
            if not self.subscriptions[task_id]:
                del self.subscriptions[task_id]

    def _next_event_id(self, task_id: str) -> int:
        self._event_ids[task_id] = self._event_ids.get(task_id, 0) + 1
        return self._event_ids[task_id]

    async def broadcast(self, task_id: str, event: dict):
        event["event_id"] = self._next_event_id(task_id)

        if task_id not in self._event_archive:
            self._event_archive[task_id] = []
        archive = self._event_archive[task_id]
        archive.append(event)
        if len(archive) > MAX_ARCHIVE:
            archive[:] = archive[-MAX_ARCHIVE:]

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
        seen: set[WebSocket] = set()
        for subs in self.subscriptions.values():
            for ws in subs:
                if ws not in seen:
                    seen.add(ws)
                    try:
                        await ws.send_json(event)
                    except Exception:
                        pass

    def store_dag_snapshot(self, task_id: str, snapshot: dict):
        self._dag_snapshots[task_id] = snapshot

    def cleanup(self, task_id: str):
        self._event_archive.pop(task_id, None)
        self._event_ids.pop(task_id, None)
        self._dag_snapshots.pop(task_id, None)
