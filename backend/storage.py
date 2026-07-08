"""Persistent storage layer using aiosqlite — async-native conversations, messages, tasks, agent results."""

import os
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

_DATA_DIR = Path(os.environ.get("AGENTSWARM_DATA_DIR", "data"))
DB_PATH = _DATA_DIR / "agentswarm.db"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Storage:
    def __init__(self, db_path: str = str(DB_PATH)):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def _get_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            self._conn = await aiosqlite.connect(self._db_path)
            self._conn.row_factory = aiosqlite.Row
            await self._conn.execute("PRAGMA journal_mode=WAL")
            await self._conn.execute("PRAGMA foreign_keys=ON")
            await self._conn.execute("PRAGMA busy_timeout=5000")
            await self._conn.execute("PRAGMA synchronous=NORMAL")
            await self._migrate()
        return self._conn

    async def _migrate(self):
        conn = await self._get_conn()
        await conn.executescript("""
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
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
        await conn.commit()

        # Migration: add dag_data column (check column exists first)
        cursor = await conn.execute("PRAGMA table_info(tasks)")
        columns = {row[1] for row in await cursor.fetchall()}
        if "dag_data" not in columns:
            await conn.execute("ALTER TABLE tasks ADD COLUMN dag_data TEXT")
            await conn.commit()

    async def close(self):
        if self._conn:
            await self._conn.close()
            self._conn = None

    # ── Conversations ──

    async def create_conversation(self, conv_id: str, title: str = "New Task") -> dict:
        now = _now()
        conn = await self._get_conn()
        await conn.execute(
            "INSERT INTO conversations (id, title, created_at) VALUES (?, ?, ?)",
            (conv_id, title, now),
        )
        await conn.commit()
        return {"id": conv_id, "title": title, "created_at": now}

    async def list_conversations(self) -> list[dict]:
        conn = await self._get_conn()
        cursor = await conn.execute(
            "SELECT id, title, created_at FROM conversations ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_conversation(self, conv_id: str) -> dict | None:
        conn = await self._get_conn()
        cursor = await conn.execute(
            "SELECT id, title, created_at FROM conversations WHERE id=?", (conv_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def delete_conversation(self, conv_id: str):
        conn = await self._get_conn()
        await conn.execute("DELETE FROM conversations WHERE id=?", (conv_id,))
        await conn.commit()

    async def update_conversation_title(self, conv_id: str, title: str):
        conn = await self._get_conn()
        await conn.execute("UPDATE conversations SET title=? WHERE id=?", (title, conv_id))
        await conn.commit()

    # ── Messages ──

    async def add_message(self, conv_id: str, role: str, content: str) -> dict:
        now = _now()
        conn = await self._get_conn()
        cursor = await conn.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?,?,?,?)",
            (conv_id, role, content, now),
        )
        await conn.commit()
        return {"id": cursor.lastrowid, "conversation_id": conv_id, "role": role, "content": content, "created_at": now}

    async def get_messages(self, conv_id: str) -> list[dict]:
        conn = await self._get_conn()
        cursor = await conn.execute(
            "SELECT id, role, content, created_at FROM messages WHERE conversation_id=? ORDER BY id",
            (conv_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    # ── Tasks ──

    async def create_task(self, task_id: str, conv_id: str, query: str) -> dict:
        now = _now()
        conn = await self._get_conn()
        await conn.execute(
            "INSERT INTO tasks (id, conversation_id, query, status, created_at) VALUES (?,?,?,'running',?)",
            (task_id, conv_id, query, now),
        )
        await conn.commit()
        return {"id": task_id, "conversation_id": conv_id, "query": query, "status": "running", "created_at": now}

    async def update_task(self, task_id: str, status: str, intent: str | None = None, subtask_count: int | None = None):
        conn = await self._get_conn()
        if intent is not None and subtask_count is not None:
            await conn.execute(
                "UPDATE tasks SET status=?, intent=?, subtask_count=? WHERE id=?",
                (status, intent, subtask_count, task_id),
            )
        else:
            await conn.execute("UPDATE tasks SET status=? WHERE id=?", (status, task_id))
        await conn.commit()

    async def store_dag_data(self, task_id: str, dag_json: str):
        conn = await self._get_conn()
        await conn.execute("UPDATE tasks SET dag_data=? WHERE id=?", (dag_json, task_id))
        await conn.commit()

    # ── Agent Results ──

    async def add_agent_result(self, task_id: str, subtask_id: str, agent_name: str, state: str,
                                output: str | None = None, error: str | None = None, retry_count: int = 0):
        now = _now()
        conn = await self._get_conn()
        await conn.execute(
            "INSERT INTO agent_results (task_id, subtask_id, agent_name, state, output, error, retry_count, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (task_id, subtask_id, agent_name, state, output, error, retry_count, now),
        )
        await conn.commit()

    async def get_agent_results(self, task_id: str) -> list[dict]:
        conn = await self._get_conn()
        cursor = await conn.execute(
            "SELECT subtask_id, agent_name, state, output, error, retry_count FROM agent_results WHERE task_id=? ORDER BY id",
            (task_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_latest_task(self, conv_id: str) -> dict | None:
        conn = await self._get_conn()
        cursor = await conn.execute(
            "SELECT id, conversation_id, query, status, intent, subtask_count, dag_data, created_at FROM tasks WHERE conversation_id=? ORDER BY created_at DESC LIMIT 1",
            (conv_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_task(self, task_id: str) -> dict | None:
        conn = await self._get_conn()
        cursor = await conn.execute(
            "SELECT id, conversation_id, query, status, intent, subtask_count, dag_data, created_at FROM tasks WHERE id=?",
            (task_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    # ── Settings ──

    async def get_settings(self) -> dict[str, str]:
        conn = await self._get_conn()
        cursor = await conn.execute("SELECT key, value FROM settings")
        rows = await cursor.fetchall()
        return {r["key"]: r["value"] for r in rows}

    async def save_settings(self, data: dict[str, str]):
        conn = await self._get_conn()
        for key, value in data.items():
            await conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=?",
                (key, value, value),
            )
        await conn.commit()


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = Storage()
    return _storage


async def close_storage():
    global _storage
    if _storage:
        await _storage.close()
        _storage = None
