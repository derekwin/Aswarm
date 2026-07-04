import pytest
from agent_swarm.mcp_gateway import MCPGateway, ToolDefinition


class TestMCPGateway:
    def test_register_and_list_tools(self):
        gateway = MCPGateway()

        async def dummy_search(query: str) -> str:
            return f"searched: {query}"

        gateway.register(
            ToolDefinition(
                name="search",
                description="Search the web",
                parameters={"query": {"type": "string", "description": "Search query"}},
                handler=dummy_search,
            )
        )

        tools = gateway.list_tools()
        tool_names = [t["name"] for t in tools]
        assert "search" in tool_names  # newly registered tool exists alongside builtins

    def test_list_available_tools(self):
        gateway = MCPGateway()
        names = gateway.available_tools()
        assert "browser" in names or "search_engine" in names

    def test_get_tool_schema(self):
        gateway = MCPGateway()

        async def dummy_search(query: str) -> str:
            return "result"

        gateway.register(
            ToolDefinition(
                name="search",
                description="Search the web",
                parameters={"query": {"type": "string"}},
                handler=dummy_search,
            )
        )

        schema = gateway.get_schema("search")
        assert schema["name"] == "search"
        assert "parameters" in schema

    def test_get_schema_nonexistent(self):
        gateway = MCPGateway()
        with pytest.raises(KeyError):
            gateway.get_schema("nonexistent")

    @pytest.mark.asyncio
    async def test_call_tool(self):
        gateway = MCPGateway()

        async def dummy_search(query: str) -> str:
            return f"result for {query}"

        gateway.register(
            ToolDefinition(
                name="search",
                description="Search",
                parameters={"query": {"type": "string"}},
                handler=dummy_search,
            )
        )

        result = await gateway.call("search", query="test query")
        assert result == "result for test query"

    @pytest.mark.asyncio
    async def test_call_nonexistent_tool(self):
        gateway = MCPGateway()
        with pytest.raises(KeyError):
            await gateway.call("nonexistent")

    def test_builtin_tools_registered(self):
        gateway = MCPGateway()
        tools = gateway.list_tools()
        tool_names = [t["name"] for t in tools]
        assert "shell" in tool_names or "browser" in tool_names
