"""Tests for SwarmOrchestrator internal helper methods."""
import pytest

from agent_swarm.agent_factory import Agent, AgentFactory
from agent_swarm.infrastructure.llm_client import LLMClient
from agent_swarm.infrastructure.tool_registry import ToolRegistry
from agent_swarm.mcp_gateway import MCPGateway
from agent_swarm.models import (
    AgentConfig,
    Subtask,
    SubtaskResult,
    SubtaskState,
    TaskDAG,
)
from agent_swarm.orchestrator import ResultAggregator, SwarmOrchestrator
from agent_swarm.state_manager import StateManager


@pytest.fixture
def gateway():
    return MCPGateway()


@pytest.fixture
def tools():
    return ToolRegistry()


@pytest.fixture
def llm():
    return LLMClient(base_url="http://localhost:11434/v1", api_key="ollama")


@pytest.fixture
def state_manager():
    import tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        yield StateManager(checkpoint_dir=tmpdir)


@pytest.fixture
def orchestrator(gateway, tools, llm, state_manager):
    factory = AgentFactory(available_tools=set(gateway.available_tools()))
    return SwarmOrchestrator(
        tools=tools, factory=factory, state_manager=state_manager, llm=llm,
    )


@pytest.fixture
def sample_agent():
    return Agent(
        name="test_agent",
        role="web_searcher",
        system_prompt="You are a test agent.",
        tools=["search_engine", "webfetch", "browser"],
        model="qwen3:4b",
        max_iterations=5,
    )


@pytest.fixture
def sample_dag():
    config = AgentConfig(name="a", role="r", system_prompt="p", tools=["shell"])
    return TaskDAG(
        task_id="test_001",
        original_query="test query",
        intent="test",
        subtasks=[
            Subtask(id="t1", agent_config=config, prompt="step 1"),
        ],
        parallel_groups=[["t1"]],
    )


class TestRegeneratePrompt:
    def test_regenerate_on_failure(self):
        prev = SubtaskResult(
            subtask_id="t1",
            state=SubtaskState.FAILED,
            error="Connection timeout",
        )
        result = SwarmOrchestrator._regenerate_prompt("original prompt", prev, 0)
        assert "Attempt 1" in result
        assert "Previous attempt failed: Connection timeout" in result
        assert "Retry with a different approach" in result

    def test_regenerate_on_low_quality(self):
        prev = SubtaskResult(
            subtask_id="t1",
            state=SubtaskState.COMPLETED,
            output="no data found, information insufficient",
        )
        result = SwarmOrchestrator._regenerate_prompt("original prompt", prev, 0)
        assert "Previous output lacked substantive content" in result

    def test_regenerate_no_issues_returns_original(self):
        prev = SubtaskResult(
            subtask_id="t1",
            state=SubtaskState.COMPLETED,
            output="Here is the comprehensive analysis...",
        )
        result = SwarmOrchestrator._regenerate_prompt("original prompt", prev, 0)
        assert result == "original prompt"


class TestFindSubtask:
    def test_find_existing(self, sample_dag):
        s = SwarmOrchestrator._find_subtask(sample_dag, "t1")
        assert s.id == "t1"

    def test_find_missing_raises(self, sample_dag):
        with pytest.raises(KeyError):
            SwarmOrchestrator._find_subtask(sample_dag, "nonexistent")


class TestBuildCapabilitiesBlock:
    def test_includes_tool_descriptions(self, orchestrator):
        block = orchestrator._build_capabilities_block(["shell"])
        assert "## Available Tools & Sandbox Environment" in block
        assert "shell" in block

    def test_python_executor_adds_libraries(self, orchestrator):
        block = orchestrator._build_capabilities_block(["python_executor"])
        assert "numpy" in block
        assert "matplotlib" in block

    def test_search_engine_adds_instructions(self, orchestrator):
        block = orchestrator._build_capabilities_block(["search_engine"])
        assert "Search & Information Retrieval" in block
        assert "webfetch" in block.lower()


class TestBuildMessages:
    def test_builds_system_and_user_messages(self, orchestrator, sample_agent):
        messages = orchestrator._build_messages(sample_agent, "do something", "")
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "do something"

    def test_includes_context(self, orchestrator, sample_agent):
        messages = orchestrator._build_messages(sample_agent, "analyze", "[t1]: upstream output here")
        system_content = messages[0]["content"]
        assert "upstream output" in system_content


class TestBuildToolsSchema:
    def test_returns_function_format(self, orchestrator):
        schemas = orchestrator._build_tools_schema(
            Agent("a", "r", "p", ["shell"], "m", 5)
        )
        assert len(schemas) > 0
        assert schemas[0]["type"] == "function"
        assert "function" in schemas[0]
        assert schemas[0]["function"]["name"] == "shell"

    def test_skips_unknown_tools(self, orchestrator):
        schemas = orchestrator._build_tools_schema(
            Agent("a", "r", "p", ["nonexistent_tool", "shell"], "m", 5)
        )
        assert len(schemas) == 1
        assert schemas[0]["function"]["name"] == "shell"


class TestResultAggregator:
    def test_aggregate_mixed_results(self):
        results = [
            SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="Result A"),
            SubtaskResult(subtask_id="t2", state=SubtaskState.FAILED, error="Error B"),
            SubtaskResult(subtask_id="t3", state=SubtaskState.COMPLETED, output="Result C"),
        ]
        agg = ResultAggregator()
        summary = agg.aggregate(results)
        assert "2/3" in summary
        assert "failed" in summary
        assert "Result A" in summary
        assert "Result C" in summary
