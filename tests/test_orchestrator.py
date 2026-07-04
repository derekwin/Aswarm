import tempfile
import pytest
from unittest.mock import AsyncMock, patch
from agent_swarm.orchestrator import SwarmOrchestrator, ResultAggregator
from agent_swarm.models import (
    TaskDAG, Subtask, AgentConfig, SwarmState, SubtaskState, SubtaskResult
)
from agent_swarm.mcp_gateway import MCPGateway
from agent_swarm.agent_factory import AgentFactory
from agent_swarm.state_manager import StateManager


@pytest.fixture
def gateway():
    return MCPGateway()


@pytest.fixture
def factory(gateway):
    return AgentFactory(gateway=gateway)


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

        assert "t1" in summary
        assert "result1" in summary
        assert "t2" in summary
        assert "result2" in summary

    def test_aggregate_with_failure(self):
        results = [
            SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="ok"),
            SubtaskResult(subtask_id="t2", state=SubtaskState.FAILED, error="something broke"),
        ]
        aggregator = ResultAggregator()
        summary = aggregator.aggregate(results)

        assert "FAILED" in summary
        assert "something broke" in summary


class TestSwarmOrchestrator:
    @pytest.mark.asyncio
    async def test_execute_completes_all_subtasks(self, gateway, factory, state_manager, sample_dag):
        orchestrator = SwarmOrchestrator(
            gateway=gateway,
            factory=factory,
            state_manager=state_manager,
            llm_base_url="http://localhost:11434/v1",
            llm_api_key="ollama",
            judge_model=None,  # disable quality gate in tests
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
    async def test_resume_from_checkpoint(self, gateway, factory, state_manager, sample_dag):
        orchestrator = SwarmOrchestrator(
            gateway=gateway,
            factory=factory,
            state_manager=state_manager,
            llm_base_url="http://localhost:11434/v1",
            llm_api_key="ollama",
            judge_model=None,  # disable quality gate in tests
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
