import tempfile
from unittest.mock import patch

import pytest

from agent_swarm.agent_factory import Agent, AgentFactory
from agent_swarm.infrastructure.llm_client import LLMClient
from agent_swarm.infrastructure.tool_registry import ToolRegistry
from agent_swarm.mcp_gateway import MCPGateway
from agent_swarm.models import AgentConfig, Subtask, SubtaskResult, SubtaskState, TaskDAG
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
    with tempfile.TemporaryDirectory() as tmpdir:
        yield StateManager(checkpoint_dir=tmpdir)


@pytest.fixture
def sample_dag():
    config = AgentConfig(name="a", role="r", system_prompt="p", tools=["shell"])
    return TaskDAG(
        task_id="test_orch_001",
        original_query="test",
        intent="test",
        subtasks=[
            Subtask(id="t1", agent_config=config, prompt="step 1"),
            Subtask(id="t2", agent_config=config, prompt="step 2"),
            Subtask(id="t3", agent_config=config, prompt="step 3", depends_on=["t1", "t2"]),
        ],
        parallel_groups=[["t1", "t2"], ["t3"]],
    )


class TestResultAggregator:
    def test_aggregate(self):
        results = [
            SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="result1"),
            SubtaskResult(subtask_id="t2", state=SubtaskState.COMPLETED, output="result2"),
        ]
        aggregator = ResultAggregator()
        summary = aggregator.aggregate(results)

        assert "2/2" in summary
        assert "result1" in summary
        assert "result2" in summary
        assert "completed" in summary

    def test_aggregate_with_failure(self):
        results = [
            SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="ok"),
            SubtaskResult(subtask_id="t2", state=SubtaskState.FAILED, error="something broke"),
        ]
        aggregator = ResultAggregator()
        summary = aggregator.aggregate(results)

        assert "1/2" in summary
        assert "failed" in summary
        assert "ok" in summary


class TestSwarmOrchestrator:
    @pytest.mark.asyncio
    async def test_execute_completes_all_subtasks(self, gateway, tools, llm, state_manager, sample_dag):
        factory = AgentFactory(available_tools=set(gateway.available_tools()))
        orchestrator = SwarmOrchestrator(
            tools=tools, factory=factory, state_manager=state_manager, llm=llm,
        )

        async def mock_run_agent(subtask_id, agent, prompt, context):
            return SubtaskResult(
                subtask_id=subtask_id,
                state=SubtaskState.COMPLETED,
                output=f"Output from {agent.name}",
            )

        with patch.object(orchestrator, "_run_single_agent", side_effect=mock_run_agent):
            state = await orchestrator.execute(sample_dag)

            assert state.current_group == 2  # all groups processed
            assert all(
                r.state == SubtaskState.COMPLETED
                for r in state.subtask_results.values()
            )

    @pytest.mark.asyncio
    async def test_resume_from_checkpoint(self, gateway, tools, llm, state_manager, sample_dag):
        factory = AgentFactory(available_tools=set(gateway.available_tools()))
        orchestrator = SwarmOrchestrator(
            tools=tools, factory=factory, state_manager=state_manager, llm=llm,
        )

        # Pre-populate a checkpoint (simulate group 1 completed)
        state = state_manager.initialize("test_orch_001", sample_dag)
        state.subtask_results["t1"] = SubtaskResult(
            subtask_id="t1", state=SubtaskState.COMPLETED, output="done"
        )
        state.subtask_results["t2"] = SubtaskResult(
            subtask_id="t2", state=SubtaskState.COMPLETED, output="done"
        )
        state.current_group = 1
        state_manager.checkpoint(state)

        async def mock_run_agent(subtask_id, agent, prompt, context):
            return SubtaskResult(
                subtask_id=subtask_id,
                state=SubtaskState.COMPLETED,
                output=f"Output from {agent.name}",
            )

        with patch.object(orchestrator, "_run_single_agent", side_effect=mock_run_agent):
            resumed_state = await orchestrator.resume("test_orch_001")

            assert resumed_state.current_group == 2
            assert resumed_state.subtask_results["t1"].state == SubtaskState.COMPLETED
            assert resumed_state.subtask_results["t3"].state == SubtaskState.COMPLETED

    @pytest.mark.asyncio
    async def test_cancelled_before_execution(self, gateway, tools, llm, state_manager, sample_dag):
        """When is_cancelled returns True, orchestrator should stop and not execute."""
        factory = AgentFactory(available_tools=set(gateway.available_tools()))
        orchestrator = SwarmOrchestrator(
            tools=tools, factory=factory, state_manager=state_manager, llm=llm,
            is_cancelled=lambda: True,
        )
        state = await orchestrator.execute(sample_dag)
        assert state.current_group == 0
        assert len(state.subtask_results) == 0

    @pytest.mark.asyncio
    async def test_on_event_callback(self, gateway, tools, llm, state_manager, sample_dag):
        events = []

        def collect_events(event_type: str, data: dict):
            events.append((event_type, data))

        factory = AgentFactory(available_tools=set(gateway.available_tools()))
        orchestrator = SwarmOrchestrator(
            tools=tools, factory=factory, state_manager=state_manager, llm=llm,
            on_event=collect_events,
        )

        anim = Agent(name="test", role="coder", system_prompt="p", tools=["shell"], model="m", max_iterations=3)

        async def mock_run_agent(subtask_id, agent, prompt, context):
            orchestrator._emit("agent_start", subtask_id=subtask_id, agent_name=agent.name, role=agent.role)
            orchestrator._emit("agent_done", subtask_id=subtask_id, state="completed", output="ok", retry_count=0)
            return SubtaskResult(subtask_id=subtask_id, state=SubtaskState.COMPLETED, output="ok")

        with patch.object(orchestrator, "_run_single_agent", side_effect=mock_run_agent):
            await orchestrator.execute(sample_dag)

        start_events = [e for e in events if e[0] == "agent_start"]
        done_events = [e for e in events if e[0] == "agent_done"]
        assert len(start_events) == 3
        assert len(done_events) == 3
