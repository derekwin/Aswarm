import tempfile
import pytest
from agent_swarm.state_manager import StateManager
from agent_swarm.models import (
    TaskDAG, Subtask, AgentConfig, SwarmState, SubtaskState, SubtaskResult
)


@pytest.fixture
def sample_dag():
    config = AgentConfig(name="a", role="r", system_prompt="p", tools=["t"])
    return TaskDAG(
        task_id="test_001",
        original_query="test query",
        intent="research",
        subtasks=[
            Subtask(id="t1", agent_config=config, prompt="step 1"),
            Subtask(id="t2", agent_config=config, prompt="step 2", depends_on=["t1"]),
        ],
        parallel_groups=[["t1"], ["t2"]],
    )


class TestStateManager:
    def test_initialize_state(self, sample_dag):
        manager = StateManager()
        state = manager.initialize("test_001", sample_dag)

        assert state.task_id == "test_001"
        assert state.current_group == 0
        assert state.subtask_results == {}

    def test_update_subtask_result(self, sample_dag):
        manager = StateManager()
        state = manager.initialize("test_001", sample_dag)

        result = SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="done")
        updated = manager.update_subtask(state, result)

        assert updated.subtask_results["t1"].state == SubtaskState.COMPLETED
        assert updated.subtask_results["t1"].output == "done"

    def test_advance_group(self, sample_dag):
        manager = StateManager()
        state = manager.initialize("test_001", sample_dag)

        assert state.current_group == 0
        advanced = manager.advance_group(state)
        assert advanced.current_group == 1

    def test_checkpoint_and_resume(self, sample_dag):
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = StateManager(checkpoint_dir=tmpdir)
            state = manager.initialize("test_001", sample_dag)

            result = SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="data")
            state = manager.update_subtask(state, result)
            state = manager.advance_group(state)

            path = manager.checkpoint(state)

            resumed = manager.resume("test_001")

            assert resumed.task_id == "test_001"
            assert resumed.current_group == 1
            assert resumed.subtask_results["t1"].state == SubtaskState.COMPLETED
            assert resumed.subtask_results["t1"].output == "data"

    def test_resume_nonexistent(self):
        manager = StateManager()
        with pytest.raises(FileNotFoundError):
            manager.resume("nonexistent_task")
