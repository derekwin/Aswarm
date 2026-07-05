import pytest
from agent_swarm.context import ContextManager
from agent_swarm.models import SubtaskResult, SubtaskState


class TestContextManager:
    def test_build_basic(self):
        cm = ContextManager(max_chars=2000)
        ctx = cm.build("web_searcher", "Search for AI chip market data", [], [])
        assert "Search for AI chip market data" in ctx
        assert "Search tips" in ctx

    def test_build_with_upstream(self):
        cm = ContextManager(max_chars=2000)
        upstream = [
            SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="Found vendor A: 30% market share"),
            SubtaskResult(subtask_id="t2", state=SubtaskState.COMPLETED, output="Policy analysis: subsidies increased"),
        ]
        ctx = cm.build("data_analyst", "Analyze market data", upstream, [])
        assert "vendor A" in ctx
        assert "Policy analysis" in ctx
        assert "Execute code" in ctx  # data_analyst tips

    def test_build_with_history(self):
        cm = ContextManager(max_chars=2000)
        history = ["User: Search for chips", "Agent: Found 3 vendors", "User: Add policy data"]
        ctx = cm.build("web_searcher", "Search again", [], history)
        assert "Recent context" in ctx
        assert "Search for chips" in ctx

    def test_compression(self):
        cm = ContextManager(max_chars=200)
        long_output = SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="x" * 1000)
        ctx = cm.build("writer", "Write report", [long_output], [])
        assert len(ctx) <= 300  # within budget + margin

    def test_prioritization(self):
        cm = ContextManager(max_chars=200)
        upstream = [SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="IMPORTANT_DATA" * 10)]
        history = ["x" * 500]
        ctx = cm.build("web_searcher", "GOAL_PRESERVED", upstream, history)
        # Goal should be preserved even under heavy compression
        assert "GOAL_PRESERVED" in ctx
