import pytest
from agent_swarm.models import AgentConfig, Subtask, TaskDAG, SubtaskState, SubtaskResult, SwarmState


class TestAgentConfig:
    def test_minimal_config(self):
        config = AgentConfig(
            name="test_agent",
            role="tester",
            system_prompt="You are a tester.",
            tools=["shell"]
        )
        assert config.model == "default"
        assert config.max_iterations == 5

    def test_full_config(self):
        config = AgentConfig(
            name="code_reviewer",
            role="reviewer",
            system_prompt="You review code.",
            tools=["file_reader", "shell"],
            model="qwen3-14b",
            max_iterations=10
        )
        assert config.model == "qwen3-14b"
        assert config.max_iterations == 10


class TestSubtask:
    def test_minimal_subtask(self):
        config = AgentConfig(name="a", role="r", system_prompt="p", tools=["t"])
        subtask = Subtask(id="t1", agent_config=config, prompt="do something")
        assert subtask.depends_on == []
        assert subtask.id == "t1"

    def test_subtask_with_deps(self):
        config = AgentConfig(name="a", role="r", system_prompt="p", tools=["t"])
        subtask = Subtask(id="t2", agent_config=config, prompt="step 2", depends_on=["t1"])
        assert subtask.depends_on == ["t1"]


class TestTaskDAG:
    def test_valid_dag(self):
        config = AgentConfig(name="a", role="r", system_prompt="p", tools=["t"])
        subtasks = [
            Subtask(id="t1", agent_config=config, prompt="step 1"),
            Subtask(id="t2", agent_config=config, prompt="step 2", depends_on=["t1"]),
        ]
        dag = TaskDAG(
            task_id="test_001",
            original_query="test query",
            intent="test",
            subtasks=subtasks,
            parallel_groups=[["t1"], ["t2"]],
        )
        assert len(dag.subtasks) == 2
        assert dag.parallel_groups == [["t1"], ["t2"]]

    def test_empty_dag(self):
        dag = TaskDAG(
            task_id="empty_001",
            original_query="simple query",
            intent="simple",
            subtasks=[],
            parallel_groups=[],
        )
        assert dag.subtasks == []


class TestSwarmState:
    def test_initial_state(self):
        config = AgentConfig(name="a", role="r", system_prompt="p", tools=["t"])
        dag = TaskDAG(
            task_id="s001",
            original_query="q",
            intent="test",
            subtasks=[Subtask(id="t1", agent_config=config, prompt="p")],
            parallel_groups=[["t1"]],
        )
        state = SwarmState(task_id="s001", dag=dag)
        assert state.current_group == 0
        assert state.subtask_results == {}
        assert state.shared_context == {}

    def test_update_subtask_result(self):
        config = AgentConfig(name="a", role="r", system_prompt="p", tools=["t"])
        dag = TaskDAG(
            task_id="s002",
            original_query="q",
            intent="test",
            subtasks=[Subtask(id="t1", agent_config=config, prompt="p")],
            parallel_groups=[["t1"]],
        )
        state = SwarmState(task_id="s002", dag=dag)
        result = SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="done")
        state.subtask_results["t1"] = result
        assert state.subtask_results["t1"].state == SubtaskState.COMPLETED
