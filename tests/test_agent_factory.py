import pytest
from agent_swarm.agent_factory import AgentFactory
from agent_swarm.models import AgentConfig
from agent_swarm.mcp_gateway import MCPGateway


class TestAgentFactory:
    def test_create_agent_returns_config(self):
        gateway = MCPGateway()
        factory = AgentFactory(gateway=gateway)

        config = AgentConfig(
            name="test_agent",
            role="tester",
            system_prompt="You are a test agent.",
            tools=["file_reader", "file_writer"],
            model="test-model",
            max_iterations=3,
        )

        agent = factory.create(config)
        assert agent is not None
        assert agent.name == "test_agent"
        assert agent.system_prompt == "You are a test agent."

    def test_create_agent_with_default_model(self):
        gateway = MCPGateway()
        factory = AgentFactory(gateway=gateway, default_model="qwen3-8b")

        config = AgentConfig(
            name="default_agent",
            role="worker",
            system_prompt="You are a worker.",
            tools=["shell"],
            model="default",
        )

        agent = factory.create(config)
        assert agent.model == "qwen3-8b"

    def test_create_agent_strips_invalid_tools(self):
        gateway = MCPGateway()
        factory = AgentFactory(gateway=gateway)

        config = AgentConfig(
            name="test_agent",
            role="tester",
            system_prompt="Test.",
            tools=["nonexistent_tool", "shell"],
            model="test-model",
        )

        agent = factory.create(config)
        assert "nonexistent_tool" not in agent.tool_names()
        assert "shell" in agent.tool_names()

    def test_create_multiple_agents_independent(self):
        gateway = MCPGateway()
        factory = AgentFactory(gateway=gateway)

        config1 = AgentConfig(
            name="agent_1",
            role="role_1",
            system_prompt="Prompt 1.",
            tools=["file_reader"],
        )
        config2 = AgentConfig(
            name="agent_2",
            role="role_2",
            system_prompt="Prompt 2.",
            tools=["file_writer"],
        )

        agent1 = factory.create(config1)
        agent2 = factory.create(config2)

        assert agent1.name != agent2.name
        assert agent1.system_prompt != agent2.system_prompt
