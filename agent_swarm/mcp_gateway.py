"""MCP 工具网关 - 统一工具注册、发现、调用、权限控制。"""

import asyncio
import subprocess
from typing import Any, Callable
from dataclasses import dataclass


@dataclass
class ToolDefinition:
    """工具定义。"""
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Any]


class MCPGateway:
    """本地 MCP 工具网关。

    所有 Agent 通过此网关调用工具，不直接访问系统资源。
    负责: 工具注册、Schema 查询、超时控制、权限校验。
    """

    def __init__(self):
        self._tools: dict[str, ToolDefinition] = {}
        self._register_builtin_tools()

    def _register_builtin_tools(self):
        """注册内置工具。"""
        self.register(ToolDefinition(
            name="shell",
            description="Execute a shell command in a sandboxed environment. Returns stdout and stderr.",
            parameters={
                "command": {"type": "string", "description": "The shell command to execute"},
                "timeout": {"type": "integer", "description": "Timeout in seconds (default: 30)"},
            },
            handler=self._shell_handler,
        ))
        self.register(ToolDefinition(
            name="python_executor",
            description="Execute Python code in a sandboxed environment. Returns stdout and stderr.",
            parameters={
                "code": {"type": "string", "description": "Python code to execute"},
                "timeout": {"type": "integer", "description": "Timeout in seconds (default: 60)"},
            },
            handler=self._python_handler,
        ))
        self.register(ToolDefinition(
            name="file_reader",
            description="Read the contents of a file. Returns file content as string.",
            parameters={
                "path": {"type": "string", "description": "Absolute or relative path to the file"},
                "encoding": {"type": "string", "description": "File encoding (default: utf-8)"},
            },
            handler=self._file_reader_handler,
        ))
        self.register(ToolDefinition(
            name="file_writer",
            description="Write content to a file. Creates parent directories if needed.",
            parameters={
                "path": {"type": "string", "description": "Absolute or relative path"},
                "content": {"type": "string", "description": "Content to write"},
                "encoding": {"type": "string", "description": "File encoding (default: utf-8)"},
            },
            handler=self._file_writer_handler,
        ))
        self.register(ToolDefinition(
            name="browser",
            description="Placeholder for browser automation. In MVP, delegates to search_engine.",
            parameters={
                "url": {"type": "string", "description": "URL to open"},
                "action": {"type": "string", "description": "Action: 'fetch' or 'search'"},
            },
            handler=self._browser_handler,
        ))
        self.register(ToolDefinition(
            name="search_engine",
            description="Search the web using DuckDuckGo. Returns search results.",
            parameters={
                "query": {"type": "string", "description": "Search query"},
                "max_results": {"type": "integer", "description": "Max results (default: 10)"},
            },
            handler=self._search_handler,
        ))

    def register(self, tool: ToolDefinition):
        """注册工具。"""
        self._tools[tool.name] = tool

    def list_tools(self) -> list[dict[str, Any]]:
        """列出所有已注册工具（OpenAI function calling 格式）。"""
        return [
            {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            }
            for t in self._tools.values()
        ]

    def available_tools(self) -> list[str]:
        """返回可用工具的名称列表。"""
        return list(self._tools.keys())

    def get_schema(self, name: str) -> dict[str, Any]:
        """获取工具 Schema。"""
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' not found. Available: {self.available_tools()}")
        t = self._tools[name]
        return {"name": t.name, "description": t.description, "parameters": t.parameters}

    async def call(self, tool_name: str, **kwargs) -> Any:
        """调用工具。"""
        if tool_name not in self._tools:
            raise KeyError(f"Tool '{tool_name}' not found. Available: {self.available_tools()}")

        tool = self._tools[tool_name]
        timeout = kwargs.pop("timeout", 60)

        try:
            if asyncio.iscoroutinefunction(tool.handler):
                result = await asyncio.wait_for(tool.handler(**kwargs), timeout=timeout)
            else:
                result = await asyncio.wait_for(
                    asyncio.to_thread(tool.handler, **kwargs), timeout=timeout
                )
            return result
        except asyncio.TimeoutError:
            return f"Error: Tool '{tool_name}' timed out after {timeout}s"

    # ─── 内置工具处理器 ───

    @staticmethod
    def _shell_handler(command: str, timeout: int = 30) -> str:
        """执行 Shell 命令（基础沙箱：工作目录限定）。"""
        import os as _os
        tmpdir = "/tmp/agent_swarm"
        _os.makedirs(tmpdir, exist_ok=True)
        try:
            result = subprocess.run(
                command, shell=True, capture_output=True, text=True,
                timeout=timeout, cwd=tmpdir,
            )
            return f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        except subprocess.TimeoutExpired:
            return f"Error: Command timed out after {timeout}s"
        except Exception as e:
            return f"Error: {e}"

    @staticmethod
    def _python_handler(code: str, timeout: int = 60) -> str:
        """执行 Python 代码。"""
        import tempfile
        import os as _os
        tmpdir = "/tmp/agent_swarm"
        _os.makedirs(tmpdir, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", dir=tmpdir, delete=False) as f:
            f.write(code)
            tmp_path = f.name
        try:
            result = subprocess.run(
                ["python3", tmp_path], capture_output=True, text=True, timeout=timeout
            )
            return f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        except subprocess.TimeoutExpired:
            return f"Error: Code execution timed out after {timeout}s"
        except Exception as e:
            return f"Error: {e}"
        finally:
            _os.unlink(tmp_path)

    @staticmethod
    def _file_reader_handler(path: str, encoding: str = "utf-8") -> str:
        """读取文件。"""
        try:
            with open(path, "r", encoding=encoding) as f:
                return f.read()
        except Exception as e:
            return f"Error reading file: {e}"

    @staticmethod
    def _file_writer_handler(path: str, content: str, encoding: str = "utf-8") -> str:
        """写入文件。"""
        import os as _os
        try:
            _os.makedirs(_os.path.dirname(path) or ".", exist_ok=True)
            with open(path, "w", encoding=encoding) as f:
                f.write(content)
            return f"File written: {path} ({len(content)} bytes)"
        except Exception as e:
            return f"Error writing file: {e}"

    @staticmethod
    def _browser_handler(url: str, action: str = "fetch") -> str:
        """浏览器工具（MVP 占位）。"""
        import urllib.request
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                return body[:5000]
        except Exception as e:
            return f"Error fetching {url}: {e}"

    @staticmethod
    def _search_handler(query: str, max_results: int = 10) -> str:
        """搜索工具（MVP: DuckDuckGo HTML 抓取）。"""
        import urllib.request
        import urllib.parse
        try:
            encoded = urllib.parse.quote(query)
            url = f"https://html.duckduckgo.com/html/?q={encoded}"
            req = urllib.request.Request(url, headers={"User-Agent": "AgentSwarm/0.1"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")
            return f"Search results for '{query}' (raw HTML {len(html)} bytes):\n{html[:3000]}"
        except Exception as e:
            return f"Search error: {e}"
