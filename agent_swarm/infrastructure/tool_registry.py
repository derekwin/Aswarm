"""Tool Registry — unified interface for agent tools with registration, discovery, and execution.

Anti-corruption layer between agents and system resources (filesystem, network, shell).
"""

import asyncio
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Any, Callable

from bs4 import BeautifulSoup
import requests

logger = logging.getLogger(__name__)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
})


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Any]


class ToolRegistry:
    """Central registry for all agent tools. Handles discovery, schema generation,
    and sandboxed execution with timeout control."""

    def __init__(self):
        self._tools: dict[str, Tool] = {}
        self._register_builtins()

    def _register_builtins(self):
        for tool in [
            Tool("shell", "Execute a shell command in sandbox", {"command": {"type": "string"}}, self._shell),
            Tool("python_executor", "Execute Python code in sandbox", {"code": {"type": "string"}, "timeout": {"type": "integer"}}, self._python),
            Tool("file_reader", "Read file contents", {"path": {"type": "string"}, "encoding": {"type": "string"}}, self._read_file),
            Tool("file_writer", "Write content to file", {"path": {"type": "string"}, "content": {"type": "string"}}, self._write_file),
            Tool("browser", "Fetch web page by URL", {"url": {"type": "string"}}, self._fetch_url),
            Tool("search_engine", "Search web (Bing → Baidu → Sogou)", {"query": {"type": "string"}, "max_results": {"type": "integer"}}, self._search),
            Tool("webfetch", "Fetch page and extract readable text", {"url": {"type": "string"}}, self._webfetch),
        ]:
            self.register(tool)

    def register(self, tool: Tool):
        self._tools[tool.name] = tool

    def names(self) -> list[str]:
        return list(self._tools.keys())

    def available_tools(self) -> list[str]:  # alias for AgentFactory compat
        return self.names()

    def schema(self, name: str) -> dict:
        t = self._get(name)
        return {"name": t.name, "description": t.description, "parameters": t.parameters}

    def schemas_for_llm(self, names: list[str]) -> list[dict]:
        return [{
            "type": "function", "function": {
                "name": s["name"], "description": s["description"],
                "parameters": {"type": "object", "properties": s["parameters"], "required": list(s["parameters"].keys())},
            }
        } for name in names if (s := self._try_schema(name))]

    async def call(self, name: str, **kwargs) -> Any:
        tool = self._get(name)
        timeout = kwargs.pop("timeout", 60)
        try:
            if asyncio.iscoroutinefunction(tool.handler):
                return await asyncio.wait_for(tool.handler(**kwargs), timeout=timeout)
            return await asyncio.wait_for(asyncio.to_thread(tool.handler, **kwargs), timeout=timeout)
        except asyncio.TimeoutError:
            return f"Tool '{name}' timed out after {timeout}s"

    def _get(self, name: str) -> Tool:
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' not found. Available: {self.names()}")
        return self._tools[name]

    def _try_schema(self, name: str) -> dict | None:
        try:
            return self.schema(name)
        except KeyError:
            return None

    # ── Tool implementations ──

    @staticmethod
    def _shell(command: str, **kw) -> str:
        ws = os.environ.get("AGENTSWARM_WORKSPACE", "/tmp/agent_swarm")
        os.makedirs(ws, exist_ok=True)
        try:
            r = subprocess.run(["sh", "-c", command], capture_output=True, text=True, timeout=kw.get("timeout", 30), cwd=ws)
            return f"STDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}"
        except subprocess.TimeoutExpired:
            return "Command timed out"
        except Exception as e:
            return f"Error: {e}"

    @staticmethod
    def _python(code: str, **kw) -> str:
        ws = os.environ.get("AGENTSWARM_WORKSPACE", "/tmp/agent_swarm")
        os.makedirs(ws, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", dir=ws, delete=False) as f:
            f.write(code)
            fp = f.name
        try:
            r = subprocess.run(["python3", fp], capture_output=True, text=True, timeout=kw.get("timeout", 60))
            return f"STDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}"
        except subprocess.TimeoutExpired:
            return "Code execution timed out"
        except Exception as e:
            return f"Error: {e}"
        finally:
            os.unlink(fp)

    @staticmethod
    def _read_file(path: str, encoding: str = "utf-8", **kw) -> str:
        ws = os.environ.get("AGENTSWARM_WORKSPACE", "")
        if ws and not path.startswith("/"):
            path = os.path.join(ws, path)
        try:
            with open(path, "r", encoding=encoding) as f:
                return f.read()
        except Exception as e:
            return f"Error reading file: {e}"

    @staticmethod
    def _write_file(path: str, content: str, encoding: str = "utf-8", **kw) -> str:
        ws = os.environ.get("AGENTSWARM_WORKSPACE", "")
        if ws and not path.startswith("/"):
            path = os.path.join(ws, path)
        try:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            with open(path, "w", encoding=encoding) as f:
                f.write(content)
            return f"File written: {path} ({len(content)} bytes)"
        except Exception as e:
            return f"Error writing file: {e}"

    @staticmethod
    def _fetch_url(url: str, **kw) -> str:
        try:
            return SESSION.get(url, timeout=15).text[:5000]
        except Exception as e:
            return f"Error: {e}"

    @staticmethod
    def _search(query: str, max_results: int = 10, **kw) -> str:
        engines = [
            ("Bing", lambda: _search_bing(query, max_results)),
            ("Baidu", lambda: _search_baidu(query, max_results)),
            ("Sogou", lambda: _search_sogou(query, max_results)),
        ]
        for name, fn in engines:
            try:
                results, err = fn()
                if results:
                    return "\n\n".join(f"{i + 1}. {t}\n   {u}\n   {s}" for i, (t, u, s) in enumerate(results))
                if err:
                    logger.debug(f"{name}: {err}")
            except Exception as e:
                logger.debug(f"{name}: {e}")
        return f"No results for '{query}'"

    @staticmethod
    def _webfetch(url: str, **kw) -> str:
        import re
        try:
            resp = SESSION.get(url, timeout=20)
            soup = BeautifulSoup(resp.text, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "header"]):
                tag.decompose()
            el = soup.select_one("article, [role=main], main, .markdown-body") or soup.body
            text = el.get_text(separator="\n", strip=True) if el else soup.get_text(separator="\n", strip=True)
            text = re.sub(r"\n{3,}", "\n\n", text).strip()[:8000]
            return text
        except Exception as e:
            return f"Error: {e}"


# ── Search engine helpers ──

def _search_bing(query: str, n: int) -> tuple[list, str]:
    try:
        soup = BeautifulSoup(SESSION.get("https://cn.bing.com/search", params={"q": query, "count": n}, timeout=15).text, "html.parser")
        results = []
        for li in soup.select("#b_results > li.b_algo, .b_algo"):
            a = li.select_one("h2 a, .b_title a")
            if not a:
                continue
            p = li.select_one(".b_caption p, .b_lineclamp2")
            results.append((a.get_text(strip=True), _clean_url(a.get("href", "")), p.get_text(strip=True) if p else ""))
        return results[:n], ""
    except Exception as e:
        return [], str(e)


def _search_baidu(query: str, n: int) -> tuple[list, str]:
    try:
        soup = BeautifulSoup(SESSION.get("https://www.baidu.com/s", params={"wd": query}, timeout=15).text, "html.parser")
        results = []
        for card in soup.select(".result, .c-container"):
            a = card.select_one("h3 a, .t a")
            if not a or not a.get("href", "").startswith("http"):
                continue
            p = card.select_one(".c-abstract")
            results.append((a.get_text(strip=True), a["href"], p.get_text(strip=True) if p else ""))
        return results[:n], ""
    except Exception as e:
        return [], str(e)


def _search_sogou(query: str, n: int) -> tuple[list, str]:
    try:
        soup = BeautifulSoup(SESSION.get("https://www.sogou.com/web", params={"query": query}, timeout=15).text, "html.parser")
        results = []
        for card in soup.select("#main .vrwrap, #main .rb"):
            a = card.select_one("h3 a, .vr-title a")
            if not a:
                continue
            p = card.select_one(".str_info, p")
            results.append((a.get_text(strip=True), a.get("href", ""), p.get_text(strip=True) if p else ""))
        return results[:n], ""
    except Exception as e:
        return [], str(e)


def _clean_url(raw: str) -> str:
    from urllib.parse import urlparse, parse_qs, urlunparse
    if not raw.startswith("http"):
        return raw
    p = urlparse(raw)
    if "bing.com" in p.netloc:
        target = parse_qs(p.query).get("u", [""])[0]
        if target.startswith("http"):
            return target
    return urlunparse((p.scheme, p.netloc, p.path, "", "", ""))
