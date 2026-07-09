"""Data Buffer — shared Key-Value memory between swarm agents.

Inspired by Aden Hive's Shared Buffer. Each node declares read/write keys
and the framework enforces data isolation. Instead of passing full upstream
outputs as context, agents retrieve only the data keys they need.

This dramatically reduces context window pressure for long task chains.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class BufferEntry:
    """A single entry in the data buffer."""
    key: str
    value: Any
    source_subtask: str = ""
    version: int = 0
    timestamp: float = 0.0


@dataclass
class KeyContract:
    """Declares which keys an agent reads and writes."""
    reads: list[str] = field(default_factory=list)
    writes: list[str] = field(default_factory=list)


class DataBuffer:
    """Shared Key-Value buffer for inter-agent communication.

    Usage:
        buf = DataBuffer()
        buf.write("raw_data", pandas_df, source="t1")
        buf.write("analysis", {"mean": 42.5}, source="t2")

        # In downstream agent:
        contract = KeyContract(reads=["raw_data", "analysis"], writes=["report"])
        context = buf.build_context(contract)  # → formatted string of only needed data
    """

    def __init__(self, max_value_chars: int = 8000):
        self._store: dict[str, BufferEntry] = {}
        self._version = 0
        self.max_value_chars = max_value_chars
        self._on_write: list[Callable[[BufferEntry], None]] = []

    def write(self, key: str, value: Any, source_subtask: str = "") -> BufferEntry:
        self._version += 1
        import time
        entry = BufferEntry(
            key=key,
            value=value,
            source_subtask=source_subtask,
            version=self._version,
            timestamp=time.time(),
        )
        self._store[key] = entry
        logger.debug(f"DataBuffer: wrote key '{key}' ({len(str(value))} chars) from [{source_subtask}]")
        for callback in self._on_write:
            try:
                callback(entry)
            except Exception:
                logger.exception("Buffer write callback failed")
        return entry

    def read(self, key: str) -> Any | None:
        entry = self._store.get(key)
        return entry.value if entry else None

    def read_str(self, key: str, max_chars: int | None = None) -> str:
        """Read a key's value as a string, truncated to max_chars."""
        val = self.read(key)
        if val is None:
            return f"(no data for key: {key})"
        s = str(val)
        limit = max_chars or self.max_value_chars
        if len(s) > limit:
            s = s[:limit] + f"\n... (truncated, {len(s)} total chars)"
        return s

    def has(self, key: str) -> bool:
        return key in self._store

    def keys(self) -> list[str]:
        return list(self._store.keys())

    def on_write(self, callback: Callable[["BufferEntry"], None]):
        """Register a callback fired whenever a key is written."""
        self._on_write.append(callback)

    def build_context(self, contract: KeyContract) -> str:
        """Build a context string containing only the keys the agent needs.

        This replaces the old approach of passing ALL upstream output as context.
        """
        parts: list[str] = []

        for key in contract.reads:
            if key in self._store:
                entry = self._store[key]
                val_str = str(entry.value)
                if len(val_str) > self.max_value_chars:
                    val_str = val_str[:self.max_value_chars] + f"\n... ({len(val_str)} total chars from [{entry.source_subtask}])"
                parts.append(f"[{key}] (from {entry.source_subtask}):\n{val_str}")
            else:
                parts.append(f"[{key}]: (not yet produced — waiting for upstream)")

        return "\n\n---\n".join(parts)

    def ingest_subtask_output(self, subtask_id: str, output: str, declared_writes: list[str] | None = None):
        """Parse a subtask's output and store declared keys.

        If declared_writes is provided, stores output under each key.
        Otherwise stores the full output under the subtask_id as key.
        """
        if declared_writes:
            for key in declared_writes:
                self.write(key, output, source_subtask=subtask_id)
        else:
            self.write(subtask_id, output, source_subtask=subtask_id)

    def snapshot(self) -> dict[str, Any]:
        """Return a serializable snapshot of current buffer state."""
        return {
            "version": self._version,
            "keys": {k: {
                "source": e.source_subtask,
                "length": len(str(e.value)),
                "version": e.version,
            } for k, e in self._store.items()},
        }

    def clear(self):
        """Reset the buffer."""
        self._store.clear()
        self._version = 0
