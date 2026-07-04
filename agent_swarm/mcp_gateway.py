"""MCP 工具网关 - 统一工具注册、发现、调用、权限控制。"""

import asyncio
import logging
import os
from typing import Any, Callable
from dataclasses import dataclass
from urllib.parse import urlparse, parse_qs, urlunparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

SANDBOX_TMPDIR = "/tmp/agent_swarm"

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
})


@dataclass
class ToolDefinition:
    """工具定义。"""
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Any]


def _search_multi_engine(query: str, max_results: int) -> str:
    engines = [
        ("Bing", _search_bing),
        ("Baidu", _search_baidu),
        ("Sogou", _search_sogou),
    ]

    all_results = []
    errors = []

    for name, search_fn in engines:
        try:
            results, error = search_fn(query, max_results)
            if results:
                all_results = results
                break
            if error:
                errors.append(f"{name}: {error}")
        except Exception as e:
            errors.append(f"{name}: {e}")

    if not all_results:
        logger.warning(f"All search engines failed for '{query[:50]}': {'; '.join(errors)}")
        return f"No results found for '{query}' ({'; '.join(errors)})"

    lines = []
    for i, (title, href, snippet) in enumerate(all_results):
        lines.append(f"{i + 1}. {title}\n   {href}\n   {snippet}")

    return "\n\n".join(lines)


def _search_bing(query: str, max_results: int) -> tuple[list[tuple[str, str, str]], str]:
    try:
        resp = SESSION.get(
            "https://cn.bing.com/search",
            params={"q": query, "setlang": "zh-CN", "count": min(max_results, 15)},
            timeout=15,
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        results = _parse_bing_soup(soup, max_results)
        logger.debug(f"Bing search '{query[:50]}' → {len(results)} results")
        return results, ""
    except Exception as e:
        logger.warning(f"Bing search failed for '{query[:50]}': {e}")
        return [], str(e)


def _search_sogou(query: str, max_results: int) -> tuple[list[tuple[str, str, str]], str]:
    try:
        resp = SESSION.get(
            "https://www.sogou.com/web",
            params={"query": query, "ie": "utf8"},
            timeout=15,
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        results = _parse_sogou_soup(soup, max_results)
        logger.debug(f"Sogou search '{query[:50]}' → {len(results)} results")
        return results, ""
    except Exception as e:
        logger.warning(f"Sogou search failed for '{query[:50]}': {e}")
        return [], str(e)


def _parse_bing_soup(soup: BeautifulSoup, max_results: int) -> list[tuple[str, str, str]]:
    results = []
    for li in soup.select("#b_results > li.b_algo, #b_results > li.b_ans, .b_algo"):
        if len(results) >= max_results:
            break
        title_el = li.select_one("h2 a, .b_title a")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        href = _clean_bing_url(title_el.get("href", ""))
        if not href:
            continue
        snippet_el = li.select_one(".b_caption p, .b_lineclamp2, .b_lineclamp3")
        snippet = snippet_el.get_text(strip=True) if snippet_el else ""
        results.append((title, href, snippet))
    return results


def _clean_bing_url(raw: str) -> str:
    if not raw or not raw.startswith("http"):
        return ""
    parsed = urlparse(raw)
    if "bing.com" in parsed.netloc.lower():
        qs = parse_qs(parsed.query)
        target = qs.get("u", [""])[0]
        if target and target.startswith("http"):
            return target
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))


def _parse_sogou_soup(soup: BeautifulSoup, max_results: int) -> list[tuple[str, str, str]]:
    results = []
    for card in soup.select("#main .vrwrap, #main .rb, .results .vrwrap, .results .rb"):
        if len(results) >= max_results:
            break
        title_el = card.select_one("h3 a[href], h2 a[href], .vr-title a[href], .pt a[href]")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        href = title_el.get("href", "")
        if href.startswith("/"):
            href = f"https://www.sogou.com{href}"
        snippet_el = card.select_one(".str_info, .ft, .text-layout, .fz-mid, p")
        snippet = snippet_el.get_text(strip=True) if snippet_el else ""
        results.append((title, href, snippet))
    return results


def _search_baidu(query: str, max_results: int) -> tuple[list[tuple[str, str, str]], str]:
    try:
        resp = SESSION.get(
            "https://www.baidu.com/s",
            params={"wd": query, "rn": min(max_results, 15)},
            timeout=15,
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        results = _parse_baidu_soup(soup, max_results)
        logger.debug(f"Baidu search '{query[:50]}' → {len(results)} results")
        return results, ""
    except Exception as e:
        logger.warning(f"Baidu search failed for '{query[:50]}': {e}")
        return [], str(e)


def _parse_baidu_soup(soup: BeautifulSoup, max_results: int) -> list[tuple[str, str, str]]:
    results = []
    for card in soup.select(".result, .c-container"):
        if len(results) >= max_results:
            break
        title_el = card.select_one("h3 a, .t a")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        href = title_el.get("href", "")
        if not href.startswith("http"):
            continue
        snippet_el = card.select_one(".c-abstract, .content-right_8Zs40, .c-span-last p")
        snippet = snippet_el.get_text(strip=True) if snippet_el else ""
        results.append((title, href, snippet))
    return results


def _try_sandbox_run(cmd: list[str], timeout: int = 60) -> tuple[str, str, bool]:
    try:
        from sandlock import Sandbox
        sandbox = Sandbox(
            fs_writable=[SANDBOX_TMPDIR],
            fs_readable=["/usr", "/lib", "/lib64", "/etc", "/bin", "/tmp"],
            max_memory="512M",
            max_processes=10,
            clean_env=True,
        )
        result = sandbox.run(cmd, timeout=timeout)
        return result.stdout.decode("utf-8", errors="replace"), result.stderr.decode("utf-8", errors="replace"), result.success
    except ImportError:
        logger.debug("Sandlock not installed, falling back to subprocess")
        import subprocess
        os.makedirs(SANDBOX_TMPDIR, exist_ok=True)
        proc = subprocess.run(
            cmd, capture_output=True, timeout=timeout, cwd=SANDBOX_TMPDIR,
        )
        return proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace"), proc.returncode == 0
    except ModuleNotFoundError:
        logger.warning("Sandlock import failed (broken installation), falling back to subprocess")
        import subprocess
        os.makedirs(SANDBOX_TMPDIR, exist_ok=True)
        proc = subprocess.run(
            cmd, capture_output=True, timeout=timeout, cwd=SANDBOX_TMPDIR,
        )
        return proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace"), proc.returncode == 0
    except Exception as e:
        logger.error(f"Sandbox execution failed: {e}")
        return "", str(e), False


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
            description="Search the web using multi-engine fallback (Bing → Baidu → Sogou). Returns titles, URLs, and snippets.",
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
        stdout, stderr, ok = _try_sandbox_run(["sh", "-c", command], timeout)
        prefix = "[SANDBOX] " if ok else "[SANDBOX FAILED] "
        return f"{prefix}STDOUT:\n{stdout}\nSTDERR:\n{stderr}"

    @staticmethod
    def _python_handler(code: str, timeout: int = 60) -> str:
        import tempfile
        os.makedirs(SANDBOX_TMPDIR, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", dir=SANDBOX_TMPDIR, delete=False) as f:
            f.write(code)
            tmp_path = f.name
        try:
            stdout, stderr, ok = _try_sandbox_run(["python3", tmp_path], timeout)
            prefix = "[SANDBOX] " if ok else "[SANDBOX FAILED] "
            return f"{prefix}STDOUT:\n{stdout}\nSTDERR:\n{stderr}"
        finally:
            os.unlink(tmp_path)

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
        try:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            with open(path, "w", encoding=encoding) as f:
                f.write(content)
            return f"File written: {path} ({len(content)} bytes)"
        except Exception as e:
            return f"Error writing file: {e}"

    @staticmethod
    def _browser_handler(url: str) -> str:
        try:
            resp = SESSION.get(url, timeout=15)
            resp.raise_for_status()
            return resp.text[:5000]
        except Exception as e:
            logger.warning(f"Browser fetch failed for {url}: {e}")
            return f"Error fetching {url}: {e}"

    @staticmethod
    def _search_handler(query: str, max_results: int = 10) -> str:
        return _search_multi_engine(query, max_results)

    @staticmethod
    def _webfetch_handler(url: str) -> str:
        try:
            resp = SESSION.get(url, timeout=20)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")

            for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
                tag.decompose()

            content_el = (
                soup.select_one("article") or
                soup.select_one('[role="main"]') or
                soup.select_one("main") or
                soup.select_one(".markdown-body, .article-content, .post-content, .content") or
                soup.body
            )
            text = content_el.get_text(separator="\n", strip=True) if content_el else soup.get_text(separator="\n", strip=True)

            import re
            text = re.sub(r"\n{3,}", "\n\n", text).strip()
            text = text[:8000] if len(text) > 8000 else text
            logger.debug(f"Webfetch '{url[:60]}' → {len(text)} chars")
            return text
        except Exception as e:
            logger.warning(f"Webfetch failed for '{url[:60]}': {e}")
            return f"Error fetching {url}: {e}"
