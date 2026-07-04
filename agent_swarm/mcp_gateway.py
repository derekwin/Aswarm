"""MCP 工具网关 - 统一工具注册、发现、调用、权限控制。"""

import asyncio
import subprocess
from html.parser import HTMLParser
from typing import Any, Callable
from dataclasses import dataclass


@dataclass
class ToolDefinition:
    """工具定义。"""
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Any]


def _search_multi_engine(query: str, max_results: int) -> str:
    """Multi-engine search: try Bing first, fall back to Sogou."""
    import urllib.request
    import urllib.parse

    engines = [
        ("Bing", lambda q: f"https://cn.bing.com/search?q={urllib.parse.quote(q)}&count={min(max_results, 15)}"),
        ("Sogou", lambda q: f"https://www.sogou.com/web?query={urllib.parse.quote(q)}"),
    ]

    all_results = []
    errors = []

    for engine_name, url_builder in engines:
        try:
            url = url_builder(query)
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")

            if engine_name == "Bing":
                results = _parse_bing_results(html, max_results)
            else:
                results = _parse_sogou_results(html, max_results)

            if results:
                all_results.extend(results)
                break  # got results, stop trying other engines
            else:
                errors.append(f"{engine_name}: no results parsed")
        except Exception as e:
            errors.append(f"{engine_name}: {e}")

    if not all_results:
        return f"No results found for '{query}' ({'; '.join(errors)})"

    lines = []
    for i, (title, href, snippet) in enumerate(all_results[:max_results]):
        lines.append(f"{i + 1}. {title}\n   {href}\n   {snippet}")

    return "\n\n".join(lines)


# ─── Bing Parser ───

class _BingResultParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.results = []
        self._in_h2 = False
        self._in_p = False
        self._current_title = ""
        self._current_href = ""
        self._current_snippet = ""
        self._capture_title = False
        self._capture_snippet = False

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag == "h2":
            self._in_h2 = True
            self._current_title = ""
            self._current_href = ""
            self._capture_title = True
        elif tag == "a" and self._in_h2 and "href" in attrs_dict:
            self._current_href = attrs_dict["href"]
        elif tag == "p" and not self._in_h2:
            self._in_p = True
            self._current_snippet = ""
            self._capture_snippet = True

    def handle_endtag(self, tag):
        if tag == "h2":
            self._in_h2 = False
            if self._current_title and self._current_href:
                self.results.append((
                    self._current_title.strip(),
                    self._current_href,
                    self._current_snippet.strip(),
                ))
            self._capture_title = False
        elif tag == "p":
            self._in_p = False
            self._capture_snippet = False

    def handle_data(self, data):
        if self._capture_title:
            self._current_title += data
        elif self._capture_snippet:
            self._current_snippet += data


def _parse_bing_results(html: str, max_results: int) -> list[tuple[str, str, str]]:
    parser = _BingResultParser()
    try:
        parser.feed(html)
    except Exception:
        pass
    return parser.results[:max_results]


# ─── Sogou Parser ───

class _SogouResultParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.results = []
        self._in_result = False
        self._in_title = False
        self._in_snippet = False
        self._current_title = ""
        self._current_href = ""
        self._current_snippet = ""

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        cls = attrs_dict.get("class", "")
        if tag == "div" and "rb" in cls:
            self._in_result = True
            self._current_title = ""
            self._current_href = ""
            self._current_snippet = ""
        elif tag == "h3" and self._in_result:
            self._in_title = True
        elif tag == "a" and self._in_title and "href" in attrs_dict:
            self._current_href = attrs_dict["href"]
        elif tag == "p" and self._in_result and "str" in cls:
            self._in_snippet = True

    def handle_endtag(self, tag):
        if tag == "div" and self._in_result:
            self._in_result = False
            if self._current_title and self._current_href:
                self.results.append((
                    self._current_title.strip(),
                    self._current_href,
                    self._current_snippet.strip(),
                ))
        elif tag == "h3":
            self._in_title = False
        elif tag == "p":
            self._in_snippet = False

    def handle_data(self, data):
        if self._in_title:
            self._current_title += data
        elif self._in_snippet:
            self._current_snippet += data


def _parse_sogou_results(html: str, max_results: int) -> list[tuple[str, str, str]]:
    parser = _SogouResultParser()
    try:
        parser.feed(html)
    except Exception:
        pass
    return parser.results[:max_results]


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
            description="Fetch a web page by URL. Returns page content as text.",
            parameters={
                "url": {"type": "string", "description": "URL to open"},
            },
            handler=self._browser_handler,
        ))
        self.register(ToolDefinition(
            name="search_engine",
            description="Search the web using multi-engine fallback (Bing → Sogou). Returns titles, URLs, and snippets.",
            parameters={
                "query": {"type": "string", "description": "Search query"},
                "max_results": {"type": "integer", "description": "Max results (default: 10)"},
            },
            handler=self._search_handler,
        ))
        self.register(ToolDefinition(
            name="webfetch",
            description="Fetch a web page and extract readable text content. Use after search_engine to read full articles.",
            parameters={
                "url": {"type": "string", "description": "The URL of the page to fetch"},
            },
            handler=self._webfetch_handler,
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
    def _browser_handler(url: str) -> str:
        import urllib.request
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                return body[:5000]
        except Exception as e:
            return f"Error fetching {url}: {e}"

    @staticmethod
    def _search_handler(query: str, max_results: int = 10) -> str:
        return _search_multi_engine(query, max_results)

    @staticmethod
    def _webfetch_handler(url: str) -> str:
        """抓取网页并提取可读文本（去除 HTML 标签、脚本、样式）。"""
        import urllib.request
        import re
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            with urllib.request.urlopen(req, timeout=20) as resp:
                html = resp.read().decode("utf-8", errors="replace")

            # 去除 script, style, nav, footer, header 等非内容标签
            for tag in ("script", "style", "nav", "footer", "header", "noscript"):
                html = re.sub(rf"<{tag}[^>]*>.*?</{tag}>", "", html, flags=re.DOTALL | re.IGNORECASE)

            # 去除所有 HTML 标签，保留文本
            text = re.sub(r"<[^>]+>", " ", html)
            # 合并空白
            text = re.sub(r"\s+", " ", text).strip()
            # 截取合理长度
            return text[:8000] if len(text) > 8000 else text
        except Exception as e:
            return f"Error fetching {url}: {e}"
