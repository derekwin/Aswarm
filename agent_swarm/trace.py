"""Structured execution tracing — records task/agent/tool timeline for debugging and analysis."""

import json
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any


@dataclass
class TraceEvent:
    timestamp: float
    event_type: str
    task_id: str
    subtask_id: str = ""
    agent_name: str = ""
    data: dict = field(default_factory=dict)


class TraceCollector:
    """Collects structured trace events during task execution."""

    def __init__(self, output_dir: str = "data/traces"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._events: list[TraceEvent] = []

    def record(self, event_type: str, task_id: str, **kwargs):
        self._events.append(TraceEvent(
            timestamp=time.time(),
            event_type=event_type,
            task_id=task_id,
            **kwargs,
        ))

    def flush(self, task_id: str):
        """Write trace to disk and clear memory."""
        if not self._events:
            return
        path = self.output_dir / f"{task_id}_{int(time.time())}.jsonl"
        with open(path, "w") as f:
            for e in self._events:
                f.write(json.dumps(asdict(e), ensure_ascii=False) + "\n")
        self._events.clear()

    def summary(self) -> dict[str, Any]:
        """Return summary statistics of collected events."""
        if not self._events:
            return {}
        types = {}
        for e in self._events:
            types[e.event_type] = types.get(e.event_type, 0) + 1
        return {
            "total_events": len(self._events),
            "event_types": types,
        }


# Module-level instance
trace = TraceCollector()
