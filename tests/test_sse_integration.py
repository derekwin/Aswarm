"""WebSocket integration tests — verify full task execution event flow, cancel, and rerun.

NOTE: These tests need updating for the WebSocket migration. The SSE /stream endpoint
has been replaced by /ws WebSocket. Tests are skipped until rewritten for WS.
"""

import asyncio
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from openai.types.chat import ChatCompletionMessage

from backend.server import app

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skip(reason="SSE /stream endpoint removed — needs WebSocket rewrite"),
]


def _make_msg(content: str, tool_calls=None) -> ChatCompletionMessage:
    return ChatCompletionMessage(
        content=content, role="assistant", refusal=None,
        annotations=[], audio=None, function_call=None, tool_calls=tool_calls,
    )


class TestSSEFullFlow:

    @pytest.mark.asyncio
    async def test_full_event_sequence(self):
        """Verify complete SSE event sequence for a successful task."""
        decomposer_response = json.dumps({
            "intent": "research",
            "subtasks": [
                {"id": "t1", "agent_config": {"name": "searcher", "role": "web_searcher",
                 "system_prompt": "Search expert.", "tools": ["search_engine"], "max_iterations": 3},
                 "prompt": "search data", "depends_on": []},
                {"id": "t2", "agent_config": {"name": "writer", "role": "writer",
                 "system_prompt": "Write expert.", "tools": ["file_writer"], "max_iterations": 2},
                 "prompt": "write report", "depends_on": ["t1"]},
            ],
            "parallel_groups": [["t1"], ["t2"]],
        })

        mock_chat = AsyncMock()
        mock_chat.side_effect = [
            _make_msg("research"),           # classify_intent
            _make_msg(decomposer_response),  # decompose
            _make_msg("t1 final output"),    # agent t1
            _make_msg("t2 final output"),    # agent t2
        ]

        with patch("agent_swarm.infrastructure.llm_client.LLMClient.chat", mock_chat):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                run_resp = await client.post("/run?query=Research+AI+chips")
                assert run_resp.status_code == 200
                task_id = run_resp.json()["task_id"]

                events = []
                async with client.stream("GET", f"/stream/{task_id}") as response:
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            try:
                                evt = json.loads(line[len("data: "):])
                                events.append(evt)
                            except json.JSONDecodeError:
                                pass
                        if events and events[-1].get("type") == "done":
                            break

                event_types = [e["type"] for e in events]
                assert "status" in event_types
                assert "dag" in event_types
                assert "agent_start" in event_types
                assert "agent_done" in event_types
                assert "done" in event_types

                dag_event = next(e for e in events if e["type"] == "dag")
                assert dag_event["intent"] == "research"
                assert len(dag_event["subtasks"]) == 2

                start_events = [e for e in events if e["type"] == "agent_start"]
                assert len(start_events) == 2

                done_events = [e for e in events if e["type"] == "agent_done"]
                assert len(done_events) == 2
                assert all(e["state"] == "completed" for e in done_events)

    @pytest.mark.asyncio
    async def test_cancel_stops_events(self):
        """Cancel should immediately push a done event to the SSE stream."""
        decomposer_response = json.dumps({
            "intent": "research",
            "subtasks": [
                {"id": "t1", "agent_config": {"name": "agent1", "role": "coder",
                 "system_prompt": "Coder.", "tools": ["shell"], "max_iterations": 5},
                 "prompt": "do task 1", "depends_on": []},
            ],
            "parallel_groups": [["t1"]],
        })

        mock_chat = AsyncMock()
        mock_chat.side_effect = [
            _make_msg("research"),
            _make_msg(decomposer_response),
            _make_msg("agent output"),
        ]

        with patch("agent_swarm.infrastructure.llm_client.LLMClient.chat", mock_chat):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                run_resp = await client.post("/run?query=Test+query")
                task_id = run_resp.json()["task_id"]

                await asyncio.sleep(0.3)
                cancel_resp = await client.post(f"/cancel/{task_id}")
                assert cancel_resp.json()["ok"] is True

                events = []
                async with client.stream("GET", f"/stream/{task_id}") as response:
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            try:
                                evt = json.loads(line[len("data: "):])
                                events.append(evt)
                            except json.JSONDecodeError:
                                pass
                        if events and events[-1].get("type") in ("done", "error"):
                            break

                done_events = [e for e in events if e["type"] == "done"]
                assert len(done_events) >= 1

    @pytest.mark.asyncio
    async def test_rerun_creates_new_task(self):
        """Rerun endpoint should create a new task with downstream subtasks."""
        decomposer_response = json.dumps({
            "intent": "research",
            "subtasks": [
                {"id": "t1", "agent_config": {"name": "agent1", "role": "coder",
                 "system_prompt": "Test.", "tools": ["shell"], "max_iterations": 3},
                 "prompt": "step 1", "depends_on": []},
                {"id": "t2", "agent_config": {"name": "agent2", "role": "writer",
                 "system_prompt": "Test.", "tools": ["file_writer"], "max_iterations": 2},
                 "prompt": "step 2", "depends_on": ["t1"]},
            ],
            "parallel_groups": [["t1"], ["t2"]],
        })

        mock_chat = AsyncMock()
        mock_chat.side_effect = [
            _make_msg("research"),           # classify_intent (run)
            _make_msg(decomposer_response),  # decompose (run)
            _make_msg("t1 output"),          # agent t1
            _make_msg("t2 output"),          # agent t2
            _make_msg("rerun t2 output"),    # agent t2 (rerun)
        ]

        with patch("agent_swarm.infrastructure.llm_client.LLMClient.chat", mock_chat):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                run_resp = await client.post("/run?query=Test+query")
                task_id = run_resp.json()["task_id"]

                async with client.stream("GET", f"/stream/{task_id}") as response:
                    events = []
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            try:
                                evt = json.loads(line[len("data: "):])
                                events.append(evt)
                            except json.JSONDecodeError:
                                pass
                        if events and events[-1].get("type") == "done":
                            break

                rerun_resp = await client.post(f"/api/rerun/{task_id}/t2")
                assert rerun_resp.status_code == 200
                rerun_data = rerun_resp.json()
                assert "task_id" in rerun_data
                assert "t2" in rerun_data["rerun_subtasks"]

                async with client.stream("GET", f"/stream/{rerun_data['task_id']}") as response:
                    rerun_events = []
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            try:
                                evt = json.loads(line[len("data: "):])
                                rerun_events.append(evt)
                            except json.JSONDecodeError:
                                pass
                        if rerun_events and rerun_events[-1].get("type") == "done":
                            break

                assert any(e["type"] == "dag" for e in rerun_events)
                assert any(e["type"] == "done" for e in rerun_events)

    @pytest.mark.asyncio
    async def test_progress_events(self):
        """Verify that progress events fire with correct completed/total counts."""
        decomposer_response = json.dumps({
            "intent": "research",
            "subtasks": [
                {"id": "t1", "agent_config": {"name": "a1", "role": "coder",
                 "system_prompt": "Coder.", "tools": ["shell"], "max_iterations": 2},
                 "prompt": "do a", "depends_on": []},
                {"id": "t2", "agent_config": {"name": "a2", "role": "writer",
                 "system_prompt": "Writer.", "tools": ["file_writer"], "max_iterations": 2},
                 "prompt": "do b", "depends_on": []},
            ],
            "parallel_groups": [["t1", "t2"]],
        })

        mock_chat = AsyncMock()
        mock_chat.side_effect = [
            _make_msg("research"),           # classify_intent
            _make_msg(decomposer_response),  # decompose
            _make_msg("a1 done"),            # agent a1
            _make_msg("a2 done"),            # agent a2
        ]

        with patch("agent_swarm.infrastructure.llm_client.LLMClient.chat", mock_chat):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                run_resp = await client.post("/run?query=test")
                task_id = run_resp.json()["task_id"]

                events = []
                async with client.stream("GET", f"/stream/{task_id}") as response:
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            try:
                                evt = json.loads(line[len("data: "):])
                                events.append(evt)
                            except json.JSONDecodeError:
                                pass
                        if events and events[-1].get("type") == "done":
                            break

                progress_events = [e for e in events if e["type"] == "progress"]
                assert len(progress_events) >= 2

                final_progress = progress_events[-1]
                assert final_progress["completed"] >= 2
                assert final_progress["total"] == 2
