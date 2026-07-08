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

    def test_required_params_on_builtins(self):
        """Verify that builtin tools with optional params only mark required ones."""
        gateway = MCPGateway()
        shell_tool = next((t for t in gateway._tools.values() if t.name == "shell"), None)
        assert shell_tool is not None
        assert shell_tool.required_params == ["command"]

        search_tool = next((t for t in gateway._tools.values() if t.name == "search_engine"), None)
        assert search_tool is not None
        assert search_tool.required_params == ["query"]

    def test_required_params_defaults_to_all(self):
        """When required_params is not specified, all param keys become required."""
        async def handler(a: str, b: str) -> str:
            return a + b
        gateway = MCPGateway()
        gateway.register(ToolDefinition(
            name="test_tool", description="test",
            parameters={"a": {"type": "string"}, "b": {"type": "string"}},
            handler=handler,
        ))
        tool = gateway._tools["test_tool"]
        assert set(tool.required_params) == {"a", "b"}

    @pytest.mark.asyncio
    async def test_shell_handler_executes_command(self):
        """Builtin shell handler should execute a simple command."""
        gateway = MCPGateway()
        result = await gateway.call("shell", command="echo hello")
        assert "hello" in result or "SANDBOX" in result

    @pytest.mark.asyncio
    async def test_file_reader_reads_file(self):
        """Builtin file_reader should read an existing file."""
        import tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("test content")
            path = f.name
        try:
            gateway = MCPGateway()
            result = await gateway.call("file_reader", path=path)
            assert "test content" in result
        finally:
            import os
            os.unlink(path)
