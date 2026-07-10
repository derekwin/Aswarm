"""Structured execution tracing — records task/agent/tool timeline for debugging and analysis."""

import json
import os
import time
from dataclasses import asdict, dataclass, field
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
    """Collects structured trace events during task execution.

    Directory is created lazily on first flush to avoid import-time side effects.
    """

    def __init__(self, output_dir: str | None = None):
        self._output_dir: str | None = output_dir
        self._events: list[TraceEvent] = []

    def _ensure_dir(self):
        if self._output_dir is None:
            data_dir = os.environ.get("AGENTSWARM_DATA_DIR", "data")
            self._output_dir = os.path.join(data_dir, "traces")
        Path(self._output_dir).mkdir(parents=True, exist_ok=True)

    def record(self, event_type: str, task_id: str, **kwargs):
        self._events.append(TraceEvent(
            timestamp=time.time(),
            event_type=event_type,
            task_id=task_id,
            **kwargs,
        ))

    def flush(self, task_id: str, clear: bool = True):
        """Write trace to disk. Set clear=False to keep events in memory."""
        if not self._events:
            return
        self._ensure_dir()
        path = Path(self._output_dir) / f"{task_id}_{int(time.time())}.jsonl"
        with open(path, "w") as f:
            for e in self._events:
                f.write(json.dumps(asdict(e), ensure_ascii=False) + "\n")
        if clear:
            self._events.clear()


# Module-level instance (directory created lazily, no import-time side effects)
trace = TraceCollector()
