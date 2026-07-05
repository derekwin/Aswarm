"""Persistent storage layer using SQLite — conversations, messages, tasks, agent results."""

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path("data/agentswarm.db")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Storage:
    def __init__(self, db_path: str = str(DB_PATH)):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._migrate()

    def _migrate(self):
        with self._lock:
            self._conn.executescript("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT 'New Task',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    query TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'running',
                    intent TEXT,
                    subtask_count INTEGER,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS agent_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    subtask_id TEXT NOT NULL,
                    agent_name TEXT,
                    state TEXT NOT NULL,
                    output TEXT,
                    error TEXT,
                    retry_count INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
                CREATE INDEX IF NOT EXISTS idx_tasks_conv ON tasks(conversation_id);
                PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;
            """)
            self._conn.commit()

    # ── Conversations ──

    def create_conversation(self, conv_id: str, title: str = "New Task") -> dict:
        now = _now()
        with self._lock:
            self._conn.execute(
                "INSERT INTO conversations (id, title, created_at) VALUES (?, ?, ?)",
                (conv_id, title, now),
            )
            self._conn.commit()
        return {"id": conv_id, "title": title, "created_at": now}

    def list_conversations(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, title, created_at FROM conversations ORDER BY created_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def get_conversation(self, conv_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT id, title, created_at FROM conversations WHERE id=?", (conv_id,)
            ).fetchone()
        return dict(row) if row else None

    def delete_conversation(self, conv_id: str):
        with self._lock:
            self._conn.execute("DELETE FROM conversations WHERE id=?", (conv_id,))
            self._conn.commit()

    def update_conversation_title(self, conv_id: str, title: str):
        with self._lock:
            self._conn.execute("UPDATE conversations SET title=? WHERE id=?", (title, conv_id))
            self._conn.commit()

    # ── Messages ──

    def add_message(self, conv_id: str, role: str, content: str) -> dict:
        now = _now()
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?,?,?,?)",
                (conv_id, role, content, now),
            )
            self._conn.commit()
        return {"id": cur.lastrowid, "conversation_id": conv_id, "role": role, "content": content, "created_at": now}

    def get_messages(self, conv_id: str) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, role, content, created_at FROM messages WHERE conversation_id=? ORDER BY id",
                (conv_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    # ── Tasks ──

    def create_task(self, task_id: str, conv_id: str, query: str) -> dict:
        now = _now()
        with self._lock:
            self._conn.execute(
                "INSERT INTO tasks (id, conversation_id, query, status, created_at) VALUES (?,?,?,'running',?)",
                (task_id, conv_id, query, now),
            )
            self._conn.commit()
        return {"id": task_id, "conversation_id": conv_id, "query": query, "status": "running", "created_at": now}

    def update_task(self, task_id: str, status: str, intent: str = None, subtask_count: int = None):
        with self._lock:
            if intent is not None and subtask_count is not None:
                self._conn.execute(
                    "UPDATE tasks SET status=?, intent=?, subtask_count=? WHERE id=?",
                    (status, intent, subtask_count, task_id),
                )
            else:
                self._conn.execute("UPDATE tasks SET status=? WHERE id=?", (status, task_id))
            self._conn.commit()

    # ── Agent Results ──

    def add_agent_result(self, task_id: str, subtask_id: str, agent_name: str, state: str,
                          output: str = None, error: str = None, retry_count: int = 0):
        now = _now()
        with self._lock:
            self._conn.execute(
                "INSERT INTO agent_results (task_id, subtask_id, agent_name, state, output, error, retry_count, created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (task_id, subtask_id, agent_name, state, output, error, retry_count, now),
            )
            self._conn.commit()

    def get_agent_results(self, task_id: str) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT subtask_id, agent_name, state, output, error, retry_count FROM agent_results WHERE task_id=? ORDER BY id",
                (task_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def close(self):
        self._conn.close()


# Singleton
_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = Storage()
    return _storage
