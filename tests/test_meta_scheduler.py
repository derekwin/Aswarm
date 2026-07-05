import json
import pytest
from unittest.mock import AsyncMock, patch
from agent_swarm.meta_scheduler import MetaScheduler, Router
from agent_swarm.models import TaskDAG, AgentConfig, Subtask


# ─── Test Data ───

SAMPLE_DECOMPOSER_OUTPUT = {
    "intent": "research",
    "subtasks": [
        {
            "id": "t1",
            "agent_config": {
                "name": "searcher",
                "role": "web_searcher",
                "system_prompt": "搜索专家",
                "tools": ["browser", "search_engine"],
                "max_iterations": 5,
            },
            "prompt": "搜索信息",
            "depends_on": [],
        },
        {
            "id": "t2",
            "agent_config": {
                "name": "writer",
                "role": "writer",
                "system_prompt": "写作专家",
                "tools": ["file_writer"],
                "max_iterations": 3,
            },
            "prompt": "写报告",
            "depends_on": ["t1"],
        },
    ],
    "parallel_groups": [["t1"], ["t2"]],
}


# ─── Router Tests ───

class TestRouter:
    def test_valid_dag(self):
        dag = TaskDAG.model_validate(
            {"task_id": "t", "original_query": "q", "intent": "r", **SAMPLE_DECOMPOSER_OUTPUT}
        )
        router = Router()
        router.validate(dag)  # should not raise

    def test_missing_parallel_group_subtask(self):
        dag = TaskDAG(
            task_id="t", original_query="q", intent="r",
            subtasks=[
                Subtask(
                    id="t1",
                    agent_config=AgentConfig(name="a", role="r", system_prompt="p", tools=["t"]),
                    prompt="p",
                ),
            ],
            parallel_groups=[["t1"], ["t2"]],  # t2 doesn't exist
        )
        router = Router()
        with pytest.raises(ValueError, match="not in subtasks"):
            router.validate(dag)

    def test_duplicate_subtask_id(self):
        dag = TaskDAG(
            task_id="t", original_query="q", intent="r",
            subtasks=[
                Subtask(
                    id="t1",
                    agent_config=AgentConfig(name="a", role="r", system_prompt="p", tools=["t"]),
                    prompt="p1",
                ),
                Subtask(
                    id="t1",  # duplicate
                    agent_config=AgentConfig(name="b", role="r", system_prompt="p", tools=["t"]),
                    prompt="p2",
                ),
            ],
            parallel_groups=[["t1"]],
        )
        router = Router()
        with pytest.raises(ValueError, match="Duplicate"):
            router.validate(dag)

    def test_circular_dependency(self):
        dag = TaskDAG(
            task_id="t", original_query="q", intent="r",
            subtasks=[
                Subtask(
                    id="t1",
                    agent_config=AgentConfig(name="a", role="r", system_prompt="p", tools=["t"]),
                    prompt="p1",
                    depends_on=["t2"],
                ),
                Subtask(
                    id="t2",
                    agent_config=AgentConfig(name="b", role="r", system_prompt="p", tools=["t"]),
                    prompt="p2",
                    depends_on=["t1"],
                ),
            ],
            parallel_groups=[["t1"], ["t2"]],
        )
        router = Router()
        with pytest.raises(ValueError, match="Circular dependency"):
            router.validate(dag)

    def test_missing_dependency(self):
        dag = TaskDAG(
            task_id="t", original_query="q", intent="r",
            subtasks=[
                Subtask(
                    id="t1",
                    agent_config=AgentConfig(name="a", role="r", system_prompt="p", tools=["t"]),
                    prompt="p",
                    depends_on=["nonexistent"],
                ),
            ],
            parallel_groups=[["t1"]],
        )
        router = Router()
        with pytest.raises(ValueError, match="not in subtasks"):
            router.validate(dag)

    def test_invalid_tool_in_dag(self):
        dag = TaskDAG(
            task_id="t", original_query="q", intent="r",
            subtasks=[
                Subtask(
                    id="t1",
                    agent_config=AgentConfig(
                        name="a", role="r", system_prompt="p",
                        tools=["nonexistent_tool_xyz"],
                    ),
                    prompt="p",
                ),
            ],
            parallel_groups=[["t1"]],
        )
        router = Router(available_tools=["shell", "browser"])
        with pytest.raises(ValueError, match="Unknown tool"):
            router.validate(dag)


# ─── MetaScheduler Tests (integration) ───

class TestMetaScheduler:
    @pytest.mark.asyncio
    async def test_decompose(self):
        scheduler = MetaScheduler(
            base_url="http://localhost:11434/v1",
            api_key="ollama",
            decomposer_model="qwen3.5:35b",
        )

        with patch.object(scheduler, "_call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = json.dumps(SAMPLE_DECOMPOSER_OUTPUT)
            dag = await scheduler.decompose("调研AI芯片", "research")
            assert dag.intent == "research"
            assert len(dag.subtasks) == 2
            assert dag.parallel_groups == [["t1"], ["t2"]]
            assert dag.subtasks[0].agent_config.name == "searcher"

    @pytest.mark.asyncio
    async def test_decompose_invalid_json(self):
        scheduler = MetaScheduler(
            base_url="http://localhost:11434/v1",
            api_key="ollama",
            decomposer_model="qwen3.5:35b",
        )

        with patch.object(scheduler, "_call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "invalid json response without proper structure"
            with pytest.raises(ValueError, match="parse"):
                await scheduler.decompose("test", "research")
