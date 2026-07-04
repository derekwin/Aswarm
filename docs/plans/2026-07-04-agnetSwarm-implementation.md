# AgentSwarm 应用层实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建 AgentSwarm 应用层代码框架，实现"输入自然语言 → AI 自动拆分任务 → 现场发明 Agent → 并行执行 → 汇总结果"的完整链路。

**Architecture:** 5 个核心模块：MetaScheduler（分类+拆分+校验）、SwarmOrchestrator（并行执行编排）、AgentFactory（动态实例化）、MCPGateway（工具网关）、StateManager（状态与断点恢复）。LLM 通过 OpenAI 兼容 API 接入，底层编排复用 Swarms 框架的 ConcurrentWorkflow。

**Tech Stack:** Python 3.10+, Pydantic v2, Swarms, asyncio, OpenAI-compatible API, pytest

---

### Task 1: 项目骨架搭建

**Files:**
- Create: `pyproject.toml`
- Create: `agent_swarm/__init__.py`

**Step 1: 创建 pyproject.toml**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "agent-swarm"
version = "0.1.0"
description = "Local Agent Swarm - AI-driven task decomposition and parallel execution"
requires-python = ">=3.10"
dependencies = [
    "pydantic>=2.0",
    "openai>=1.0",
    "swarms>=6.0",
    "pyyaml>=6.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "ruff>=0.3",
]
```

**Step 2: 创建 agent_swarm/__init__.py**

```python
"""AgentSwarm - AI-driven task decomposition and parallel agent execution."""

from agent_swarm.meta_scheduler import MetaScheduler
from agent_swarm.orchestrator import SwarmOrchestrator
from agent_swarm.agent_factory import AgentFactory
from agent_swarm.mcp_gateway import MCPGateway
from agent_swarm.state_manager import StateManager
from agent_swarm.models import TaskDAG, Subtask, AgentConfig, SwarmState

__all__ = [
    "MetaScheduler",
    "SwarmOrchestrator",
    "AgentFactory",
    "MCPGateway",
    "StateManager",
    "TaskDAG",
    "Subtask",
    "AgentConfig",
    "SwarmState",
]
```

**Step 3: 安装依赖验证**

Run: `pip install -e ".[dev]"`

---

### Task 2: 数据模型 (models.py)

**Files:**
- Create: `agent_swarm/models.py`
- Create: `tests/test_models.py`

**Step 1: 写测试**

```python
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
```

**Step 2: 运行测试验证失败**

Run: `pytest tests/test_models.py -v`
Expected: FAIL (模块不存在)

**Step 3: 实现 models.py**

```python
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


class SubtaskState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AgentConfig(BaseModel):
    """由 Decomposer 现场生成的 Agent 配置。"""
    name: str = Field(description="Agent 的唯一名称，如 'gpu_market_searcher'")
    role: str = Field(description="角色分类，如 'web_searcher', 'coder', 'writer'")
    system_prompt: str = Field(description="完全由 LLM 生成的 Agent 角色定义")
    tools: list[str] = Field(description="Agent 可用的工具列表")
    model: str = Field(default="default", description="可选的模型覆盖")
    max_iterations: int = Field(default=5, description="最大推理轮次")


class Subtask(BaseModel):
    """单个子任务。"""
    id: str = Field(description="子任务 ID，如 't1'")
    agent_config: AgentConfig = Field(description="该子任务对应的 Agent 配置")
    prompt: str = Field(description="子任务的具体描述")
    depends_on: list[str] = Field(default_factory=list, description="依赖的子任务 ID 列表")


class TaskDAG(BaseModel):
    """Decomposer 完整输出。"""
    task_id: str = Field(description="任务唯一 ID")
    original_query: str = Field(description="用户原始输入")
    intent: str = Field(description="任务意图分类，如 'research', 'code', 'write', 'multi'")
    subtasks: list[Subtask] = Field(description="子任务列表")
    parallel_groups: list[list[str]] = Field(description="并行组，如 [['t1','t2'], ['t3']]")


class SubtaskResult(BaseModel):
    """单个子任务的执行结果。"""
    subtask_id: str
    state: SubtaskState = SubtaskState.PENDING
    output: str | None = None
    error: str | None = None
    iterations_used: int = 0


class SwarmState(BaseModel):
    """整个 Swarm 的运行时状态。"""
    task_id: str
    dag: TaskDAG
    current_group: int = 0
    subtask_results: dict[str, SubtaskResult] = Field(default_factory=dict)
    shared_context: dict[str, Any] = Field(default_factory=dict)
    checkpoint_path: str | None = None
```

**Step 4: 运行测试验证通过**

Run: `pytest tests/test_models.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add agent_swarm/models.py tests/test_models.py pyproject.toml agent_swarm/__init__.py
git commit -m "feat: add data models and project skeleton"
```

---

### Task 3: Prompt 模板 (Decomposer 核心)

**Files:**
- Create: `agent_swarm/prompts/__init__.py`
- Create: `agent_swarm/prompts/classifier.py`
- Create: `agent_swarm/prompts/decomposer.py`

**Step 1: 实现 classifier.py**

```python
"""IntentClassifier 的 Prompt 模板。"""

CLASSIFIER_SYSTEM_PROMPT = """你是一个任务分类器。分析用户输入，判断任务类型。

类型定义:
- research: 需要搜索、收集信息、调研分析
- code: 需要编写、修改、审查代码
- write: 需要撰写文档、报告、文章
- analyze: 需要分析数据、推理、计算
- multi: 包含多种类型的复杂任务

只返回类型名称，不要任何额外文字。"""

CLASSIFIER_USER_TEMPLATE = """请分类以下任务:

{query}"""
```

**Step 2: 实现 decomposer.py**

```python
"""Decomposer 的 Prompt 模板和 few-shot 示例。"""

DECOMPOSER_SYSTEM_PROMPT = """你是一个任务分解与 Agent 设计专家。给定用户需求，你需要:

1. 将复杂任务拆分为可独立执行的子任务，形成 DAG 依赖图
2. 为每个子任务现场设计一个 Agent: 命名、定义角色、编写 system_prompt、分配工具
3. 规划并行执行顺序，互不依赖的子任务放入同一 parallel_group

规则:
- 每个 Agent 的 system_prompt 必须具体、可执行，不少于 50 字
- 工具只能从可用列表中选择: browser, python_executor, file_reader, file_writer, shell, search_engine
- parallel_groups 中每个 group 内的子任务必须互相无依赖
- 拆分子任务数量控制在 3~7 个
- 输出严格 JSON 格式，不要任何额外文字"""

FEW_SHOT_EXAMPLES = [
    {
        "query": "调研2025年国产AI芯片市场并生成分析报告",
        "output": {
            "intent": "research",
            "subtasks": [
                {
                    "id": "t1",
                    "agent_config": {
                        "name": "chip_market_searcher",
                        "role": "web_searcher",
                        "system_prompt": (
                            "你是一个半导体行业分析师，擅长搜索芯片市场数据。"
                            "你需要搜索: 厂商名单、市场份额、出货量、产品线、融资信息。"
                            "优先搜索中文来源: 半导体行业观察、集微网、知乎、各厂商官网。"
                            "返回结构化数据: 厂商名、主要产品、市场定位、竞争优势。"
                        ),
                        "tools": ["search_engine", "browser"],
                        "max_iterations": 5
                    },
                    "prompt": "搜索2025年国产AI芯片厂商市场份额、出货量、主要产品线、融资情况",
                    "depends_on": []
                },
                {
                    "id": "t2",
                    "agent_config": {
                        "name": "policy_analyst",
                        "role": "web_searcher",
                        "system_prompt": (
                            "你是一个政策研究分析师，擅长从政策文件中提取关键信息。"
                            "搜索与国产芯片相关的国家政策、补贴计划、产业规划。"
                            "关注: 发改委、工信部、科技部发布的半导体相关政策。"
                        ),
                        "tools": ["search_engine", "browser"],
                        "max_iterations": 4
                    },
                    "prompt": "搜索2024-2025年国产芯片相关政策、补贴、产业规划",
                    "depends_on": []
                },
                {
                    "id": "t3",
                    "agent_config": {
                        "name": "data_analyst",
                        "role": "data_analyst",
                        "system_prompt": (
                            "你是一个数据分析师，擅长从结构化数据中提取洞察。"
                            "分析上游Agent传来的厂商数据，识别市场趋势、竞争格局、增长点。"
                            "输出: 市场规模估算、CR3/CR5集中度、各厂商SWOT分析。"
                        ),
                        "tools": ["python_executor"],
                        "max_iterations": 5
                    },
                    "prompt": "分析t1和t2收集的数据，提炼市场趋势、竞争格局、关键发现",
                    "depends_on": ["t1", "t2"]
                },
                {
                    "id": "t4",
                    "agent_config": {
                        "name": "report_writer",
                        "role": "writer",
                        "system_prompt": (
                            "你是一个专业分析师报告撰写者。"
                            "基于上游Agent的分析结果，撰写结构化的市场分析报告。"
                            "报告结构: 摘要、市场概览、厂商分析、政策环境、趋势预测、结论。"
                            "语言专业但不晦涩，适合管理层阅读。"
                        ),
                        "tools": ["file_writer"],
                        "max_iterations": 3
                    },
                    "prompt": "基于t3的分析结果，撰写一篇2000字的国产AI芯片市场分析报告，保存为 report.md",
                    "depends_on": ["t3"]
                }
            ],
            "parallel_groups": [["t1", "t2"], ["t3"], ["t4"]]
        }
    },
    {
        "query": "写一个Python爬虫，爬取豆瓣电影Top250并保存为CSV",
        "output": {
            "intent": "code",
            "subtasks": [
                {
                    "id": "t1",
                    "agent_config": {
                        "name": "requirements_analyst",
                        "role": "coder",
                        "system_prompt": (
                            "你是一个Python爬虫专家。分析需求，确定技术方案。"
                            "考虑: 反爬策略、数据字段、存储格式、异常处理。"
                            "输出: 技术方案文档。"
                        ),
                        "tools": ["browser"],
                        "max_iterations": 3
                    },
                    "prompt": "分析豆瓣电影Top250页面结构，确定爬取方案",
                    "depends_on": []
                },
                {
                    "id": "t2",
                    "agent_config": {
                        "name": "code_writer",
                        "role": "coder",
                        "system_prompt": (
                            "你是一个Python开发工程师，擅长编写爬虫代码。"
                            "使用 requests + BeautifulSoup + csv 模块。"
                            "代码需要: User-Agent 伪装、延时控制、异常处理、进度显示。"
                            "输出完整可运行的 .py 文件。"
                        ),
                        "tools": ["file_writer", "python_executor"],
                        "max_iterations": 8
                    },
                    "prompt": "编写Python爬虫代码，爬取豆瓣电影Top250，字段包括: 排名、片名、评分、评价人数、简介，保存为 douban_top250.csv",
                    "depends_on": ["t1"]
                },
                {
                    "id": "t3",
                    "agent_config": {
                        "name": "code_reviewer",
                        "role": "reviewer",
                        "system_prompt": (
                            "你是一个代码审查员，检查爬虫代码的健壮性和合规性。"
                            "检查: 异常处理是否完善、反爬措施是否到位、代码可读性。"
                            "如果发现 bug，直接修复。"
                        ),
                        "tools": ["file_reader", "file_writer", "python_executor"],
                        "max_iterations": 5
                    },
                    "prompt": "审查并测试t2编写的爬虫代码，修复发现的问题",
                    "depends_on": ["t2"]
                }
            ],
            "parallel_groups": [["t1"], ["t2"], ["t3"]]
        }
    },
    {
        "query": "对比分析 React 和 Vue 在2025年的生态和发展趋势",
        "output": {
            "intent": "research",
            "subtasks": [
                {
                    "id": "t1",
                    "agent_config": {
                        "name": "react_researcher",
                        "role": "web_searcher",
                        "system_prompt": (
                            "你是一个前端技术研究员，专注React生态。"
                            "搜索React 2025年: 新版本特性、Next.js发展、状态管理趋势、社区活跃度。"
                            "关注官方博客、GitHub stars趋势、npm下载量。"
                        ),
                        "tools": ["search_engine", "browser"],
                        "max_iterations": 5
                    },
                    "prompt": "调研React在2025年的生态系统、版本更新、社区趋势",
                    "depends_on": []
                },
                {
                    "id": "t2",
                    "agent_config": {
                        "name": "vue_researcher",
                        "role": "web_searcher",
                        "system_prompt": (
                            "你是一个前端技术研究员，专注Vue生态。"
                            "搜索Vue 2025年: Vue 3.x新特性、Nuxt 4发展、Vite生态、社区活跃度。"
                            "关注官方博客、GitHub stars趋势、npm下载量。"
                        ),
                        "tools": ["search_engine", "browser"],
                        "max_iterations": 5
                    },
                    "prompt": "调研Vue在2025年的生态系统、版本更新、社区趋势",
                    "depends_on": []
                },
                {
                    "id": "t3",
                    "agent_config": {
                        "name": "comparison_analyst",
                        "role": "data_analyst",
                        "system_prompt": (
                            "你是一个技术对比分析师。基于React和Vue的调研数据，"
                            "从学习曲线、性能、生态丰富度、招聘需求、未来发展 5 个维度做对比。"
                            "输出: 对比表格 + 各维度详细分析 + 选型建议。"
                        ),
                        "tools": ["python_executor", "file_writer"],
                        "max_iterations": 5
                    },
                    "prompt": "对比分析t1和t2的数据，从多个维度给出结论和建议",
                    "depends_on": ["t1", "t2"]
                }
            ],
            "parallel_groups": [["t1", "t2"], ["t3"]]
        }
    }
]


DECOMPOSER_USER_TEMPLATE = """可用工具列表:
{tools}

用户需求:
{query}

请输出任务拆分的 JSON:"""
```

**Step 3: 实现 prompts/__init__.py**

```python
"""Prompt templates for AgentSwarm."""

from agent_swarm.prompts.classifier import CLASSIFIER_SYSTEM_PROMPT, CLASSIFIER_USER_TEMPLATE
from agent_swarm.prompts.decomposer import (
    DECOMPOSER_SYSTEM_PROMPT,
    DECOMPOSER_USER_TEMPLATE,
    FEW_SHOT_EXAMPLES,
)

__all__ = [
    "CLASSIFIER_SYSTEM_PROMPT",
    "CLASSIFIER_USER_TEMPLATE",
    "DECOMPOSER_SYSTEM_PROMPT",
    "DECOMPOSER_USER_TEMPLATE",
    "FEW_SHOT_EXAMPLES",
]
```

---

### Task 4: MCP Gateway (工具网关)

**Files:**
- Create: `agent_swarm/mcp_gateway.py`
- Create: `tests/test_mcp_gateway.py`

**Step 1: 写测试**

```python
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
        assert len(tools) == 1
        assert tools[0]["name"] == "search"

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
        # 内置工具应该已注册
        assert "shell" in tool_names or "browser" in tool_names
```

**Step 2: 实现 mcp_gateway.py**

```python
"""MCP 工具网关 - 统一工具注册、发现、调用、权限控制。"""

import asyncio
import subprocess
from typing import Any, Callable
from dataclasses import dataclass, field


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
        try:
            result = subprocess.run(
                command, shell=True, capture_output=True, text=True,
                timeout=timeout, cwd="/tmp/agent_swarm",
            )
            return f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        except subprocess.TimeoutExpired:
            return f"Error: Command timed out after {timeout}s"
        except Exception as e:
            return f"Error: {e}"

    @staticmethod
    def _python_handler(code: str, timeout: int = 60) -> str:
        """执行 Python 代码。"""
        import tempfile, os
        tmpdir = "/tmp/agent_swarm"
        os.makedirs(tmpdir, exist_ok=True)
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
        """写入文件。"""
        import os
        try:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
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
        import urllib.request, urllib.parse
        try:
            encoded = urllib.parse.quote(query)
            url = f"https://html.duckduckgo.com/html/?q={encoded}"
            req = urllib.request.Request(url, headers={"User-Agent": "AgentSwarm/0.1"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")
            # 简单提取文本（完整 HTML 解析留给二期）
            return f"Search results for '{query}' (raw HTML {len(html)} bytes):\n{html[:3000]}"
        except Exception as e:
            return f"Search error: {e}"
```

**Step 3: 运行测试**

Run: `pytest tests/test_mcp_gateway.py -v`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add agent_swarm/mcp_gateway.py tests/test_mcp_gateway.py
git commit -m "feat: add MCP gateway with builtin tools"
```

---

### Task 5: Agent Factory (动态 Agent 实例化)

**Files:**
- Create: `agent_swarm/agent_factory.py`
- Create: `tests/test_agent_factory.py`

**Step 1: 写测试**

```python
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
        # shell should be present, nonexistent_tool should be stripped
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
```

**Step 2: 实现 agent_factory.py**

```python
"""Agent Factory - 根据 Decomposer 生成的 AgentConfig 动态实例化 Agent。"""

from agent_swarm.mcp_gateway import MCPGateway
from agent_swarm.models import AgentConfig


class Agent:
    """动态生成的 Agent 实例。

    封装了: 名称、角色、system_prompt、可用工具列表、模型选择。
    实际 LLM 调用由 SwarmOrchestrator 管理。
    """

    def __init__(
        self,
        name: str,
        role: str,
        system_prompt: str,
        tools: list[str],
        model: str,
        max_iterations: int,
    ):
        self.name = name
        self.role = role
        self.system_prompt = system_prompt
        self._tools = tools
        self.model = model
        self.max_iterations = max_iterations

    def tool_names(self) -> list[str]:
        """返回 Agent 的可用工具名称列表。"""
        return list(self._tools)

    def __repr__(self) -> str:
        return f"Agent(name={self.name!r}, role={self.role!r}, model={self.model!r})"


class AgentFactory:
    """根据 AgentConfig 动态创建 Agent 实例。

    职责:
    - 校验工具是否存在（过滤无效工具）
    - 注入默认模型
    - 克隆 Agent 模板
    """

    def __init__(self, gateway: MCPGateway, default_model: str = "qwen3-8b"):
        self._gateway = gateway
        self.default_model = default_model

    def create(self, config: AgentConfig) -> Agent:
        """根据配置创建 Agent 实例。"""
        # 解析模型: "default" → 使用默认模型
        model = config.model if config.model != "default" else self.default_model

        # 校验工具: 只保留已注册的工具
        available = set(self._gateway.available_tools())
        valid_tools = [t for t in config.tools if t in available]
        invalid_tools = [t for t in config.tools if t not in available]

        if invalid_tools:
            import logging
            logging.warning(
                f"Agent '{config.name}': ignoring invalid tools {invalid_tools}. "
                f"Available: {available}"
            )

        return Agent(
            name=config.name,
            role=config.role,
            system_prompt=config.system_prompt,
            tools=valid_tools,
            model=model,
            max_iterations=config.max_iterations,
        )
```

**Step 3: 运行测试**

Run: `pytest tests/test_agent_factory.py -v`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add agent_swarm/agent_factory.py tests/test_agent_factory.py
git commit -m "feat: add agent factory with dynamic instantiation"
```

---

### Task 6: State Manager (状态管理与 Checkpoint)

**Files:**
- Create: `agent_swarm/state_manager.py`
- Create: `tests/test_state_manager.py`

**Step 1: 写测试**

```python
import json
import os
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

            # Update some state
            result = SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="data")
            state = manager.update_subtask(state, result)
            state = manager.advance_group(state)

            # Checkpoint
            path = manager.checkpoint(state)

            # Resume
            resumed = manager.resume("test_001")

            assert resumed.task_id == "test_001"
            assert resumed.current_group == 1
            assert resumed.subtask_results["t1"].state == SubtaskState.COMPLETED
            assert resumed.subtask_results["t1"].output == "data"

    def test_resume_nonexistent(self):
        manager = StateManager()
        with pytest.raises(FileNotFoundError):
            manager.resume("nonexistent_task")

    def test_shared_context(self, sample_dag):
        manager = StateManager()
        state = manager.initialize("test_001", sample_dag)

        state.shared_context["key1"] = "value1"
        state.shared_context["key2"] = {"nested": True}

        assert state.shared_context["key1"] == "value1"
        assert state.shared_context["key2"]["nested"] is True
```

**Step 2: 实现 state_manager.py**

```python
"""状态管理与 Checkpoint - 任务状态追踪、子任务结果记录、断点续跑。"""

import json
import os
from datetime import datetime
from agent_swarm.models import TaskDAG, SwarmState, SubtaskResult


class StateManager:
    """管理 Swarm 任务的完整生命周期状态。

    职责:
    - 初始化任务状态
    - 更新子任务结果
    - 推进并行组
    - Checkpoint 到磁盘（JSON 文件）
    - 从 Checkpoint 恢复
    """

    def __init__(self, checkpoint_dir: str = "./checkpoints"):
        self.checkpoint_dir = checkpoint_dir
        os.makedirs(checkpoint_dir, exist_ok=True)

    def initialize(self, task_id: str, dag: TaskDAG) -> SwarmState:
        """为新任务创建初始状态。"""
        return SwarmState(task_id=task_id, dag=dag)

    def update_subtask(self, state: SwarmState, result: SubtaskResult) -> SwarmState:
        """更新某个子任务的结果。"""
        state.subtask_results[result.subtask_id] = result
        return state

    def advance_group(self, state: SwarmState) -> SwarmState:
        """推进到下一个并行组。"""
        state.current_group += 1
        return state

    def checkpoint(self, state: SwarmState) -> str:
        """将当前状态序列化到磁盘。

        返回 checkpoint 文件路径。
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{state.task_id}_{timestamp}.json"
        path = os.path.join(self.checkpoint_dir, filename)

        state.checkpoint_path = path
        with open(path, "w", encoding="utf-8") as f:
            f.write(state.model_dump_json(indent=2))

        return path

    def resume(self, task_id: str) -> SwarmState:
        """从最新的 checkpoint 恢复任务状态。"""
        checkpoints = sorted(
            [f for f in os.listdir(self.checkpoint_dir) if f.startswith(task_id)],
            reverse=True,
        )
        if not checkpoints:
            raise FileNotFoundError(
                f"No checkpoint found for task '{task_id}' in {self.checkpoint_dir}"
            )

        latest = checkpoints[0]
        path = os.path.join(self.checkpoint_dir, latest)

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        state = SwarmState.model_validate(data)
        state.checkpoint_path = path
        return state

    def list_checkpoints(self, task_id: str | None = None) -> list[str]:
        """列出所有 checkpoint 文件。"""
        files = os.listdir(self.checkpoint_dir)
        if task_id:
            files = [f for f in files if f.startswith(task_id)]
        return sorted(files)

    def cleanup(self, task_id: str, keep_latest: int = 3):
        """清理旧 checkpoint，只保留最近 N 个。"""
        checkpoints = sorted(
            [f for f in os.listdir(self.checkpoint_dir) if f.startswith(task_id)]
        )
        for old in checkpoints[:-keep_latest]:
            os.remove(os.path.join(self.checkpoint_dir, old))
```

**Step 3: 运行测试**

Run: `pytest tests/test_state_manager.py -v`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add agent_swarm/state_manager.py tests/test_state_manager.py
git commit -m "feat: add state manager with checkpoint/resume"
```

---

### Task 7: Meta Scheduler (分类 + 拆分 + 校验)

**Files:**
- Create: `agent_swarm/meta_scheduler.py`
- Create: `tests/test_meta_scheduler.py`

**Step 1: 写测试**

```python
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
        with pytest.raises(ValueError, match="circular"):
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
        with pytest.raises(ValueError, match="not found"):
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
    async def test_classify(self):
        # Mock LLM response
        scheduler = MetaScheduler(
            base_url="http://localhost:11434/v1",
            api_key="ollama",
            classifier_model="qwen3:4b",
        )

        with patch.object(scheduler, "_call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "research"
            intent = await scheduler.classify("调研AI芯片市场")
            assert intent == "research"

    @pytest.mark.asyncio
    async def test_decompose(self):
        scheduler = MetaScheduler(
            base_url="http://localhost:11434/v1",
            api_key="ollama",
            decomposer_model="qwen3:14b",
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
            decomposer_model="qwen3:14b",
        )

        with patch.object(scheduler, "_call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "invalid json response without proper structure"
            with pytest.raises(ValueError, match="parse"):
                await scheduler.decompose("test", "research")

    @pytest.mark.asyncio
    async def test_full_pipeline(self):
        """完整 pipeline: classify → decompose → validate。"""
        scheduler = MetaScheduler(
            base_url="http://localhost:11434/v1",
            api_key="ollama",
            classifier_model="qwen3:4b",
            decomposer_model="qwen3:14b",
        )

        with patch.object(scheduler, "_call_llm", new_callable=AsyncMock) as mock_llm:
            # First call: classify
            # Second call: decompose
            mock_llm.side_effect = ["research", json.dumps(SAMPLE_DECOMPOSER_OUTPUT)]

            dag = await scheduler.process("调研2025年AI芯片市场")

            assert dag.intent == "research"
            assert len(dag.subtasks) == 2
            assert dag.subtasks[0].agent_config.name == "searcher"
```

**Step 2: 实现 meta_scheduler.py**

```python
"""Meta-Scheduler: 意图分类、任务分解、DAG 校验。

核心流程: classify → decompose → validate → TaskDAG
"""

import json
import logging
import uuid
import re
from openai import AsyncOpenAI

from agent_swarm.models import TaskDAG, AgentConfig, Subtask
from agent_swarm.prompts.classifier import CLASSIFIER_SYSTEM_PROMPT, CLASSIFIER_USER_TEMPLATE
from agent_swarm.prompts.decomposer import (
    DECOMPOSER_SYSTEM_PROMPT,
    DECOMPOSER_USER_TEMPLATE,
    FEW_SHOT_EXAMPLES,
)

logger = logging.getLogger(__name__)


class Router:
    """校验 Decomposer 输出的 DAG 合法性。

    检查项:
    - 子任务 ID 唯一
    - 依赖关系的目标子任务必须存在
    - 无循环依赖
    - parallel_groups 中的子任务必须存在
    - 工具名称必须在可用列表中
    """

    def __init__(self, available_tools: list[str] | None = None):
        self.available_tools = available_tools

    def validate(self, dag: TaskDAG) -> TaskDAG:
        """校验 DAG。校验通过返回原对象，失败抛出 ValueError。"""
        subtask_ids = {s.id for s in dag.subtasks}
        all_tools = set()
        for s in dag.subtasks:
            all_tools.update(s.agent_config.tools)

        # 1. 子任务 ID 唯一
        if len(subtask_ids) != len(dag.subtasks):
            raise ValueError("Duplicate subtask IDs found")

        # 2. 依赖关系检查
        for s in dag.subtasks:
            for dep in s.depends_on:
                if dep not in subtask_ids:
                    raise ValueError(f"Subtask '{s.id}' depends on '{dep}' which is not in subtasks")

        # 3. 循环依赖检查 (DFS)
        self._check_cycles(dag)

        # 4. parallel_groups 中的子任务必须存在
        for group in dag.parallel_groups:
            for tid in group:
                if tid not in subtask_ids:
                    raise ValueError(f"Parallel group contains '{tid}' which is not in subtasks")

        # 5. 工具名称校验
        if self.available_tools:
            unknown = all_tools - set(self.available_tools)
            if unknown:
                raise ValueError(
                    f"Unknown tool(s): {unknown}. Available: {self.available_tools}"
                )

        return dag

    def _check_cycles(self, dag: TaskDAG):
        """DFS 检测循环依赖。"""
        adj = {s.id: set(s.depends_on) for s in dag.subtasks}
        WHITE, GRAY, BLACK = 0, 1, 2
        color = {sid: WHITE for sid in adj}

        def dfs(node):
            color[node] = GRAY
            for neighbor in adj.get(node, []):
                if color[neighbor] == GRAY:
                    raise ValueError(f"Circular dependency detected involving '{node}' and '{neighbor}'")
                if color[neighbor] == WHITE:
                    dfs(neighbor)
            color[node] = BLACK

        for node in adj:
            if color[node] == WHITE:
                dfs(node)


class MetaScheduler:
    """元调度器: 负责意图分类、任务分解、DAG 校验。

    使用两个 LLM:
    - classifier_model (小模型, 1B-4B): 快速意图分类
    - decomposer_model (中等模型, 7B-14B): 任务拆分 + Agent 配置生成

    用法:
        scheduler = MetaScheduler(base_url="http://localhost:11434/v1", api_key="ollama")
        dag = await scheduler.process("调研2025年AI芯片市场")
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        classifier_model: str = "qwen3:4b",
        decomposer_model: str = "qwen3:14b",
    ):
        self.client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        self.classifier_model = classifier_model
        self.decomposer_model = decomposer_model
        self.router = Router()

    async def process(self, query: str) -> TaskDAG:
        """完整处理流水线: classify → decompose → validate。"""
        intent = await self.classify(query)
        dag = await self.decompose(query, intent)

        # 更新 Router 的工具列表校验
        all_tools = set()
        for s in dag.subtasks:
            all_tools.update(s.agent_config.tools)
        self.router.available_tools = list(all_tools)  # MVP: 不做严格校验

        self.router.validate(dag)
        return dag

    async def classify(self, query: str) -> str:
        """意图分类 - 用小模型快速判断任务类型。"""
        user_prompt = CLASSIFIER_USER_TEMPLATE.format(query=query)

        response = await self._call_llm(
            model=self.classifier_model,
            system_prompt=CLASSIFIER_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.1,
        )

        intent = response.strip().lower()
        valid_intents = {"research", "code", "write", "analyze", "multi"}
        if intent not in valid_intents:
            logger.warning(f"Unknown intent '{intent}', defaulting to 'multi'")
            intent = "multi"

        return intent

    async def decompose(self, query: str, intent: str) -> TaskDAG:
        """任务分解 - 拆分任务 DAG 并现场生成 Agent 配置。"""
        # 构建 few-shot 示例
        few_shot_text = self._build_few_shot()

        user_prompt = (
            few_shot_text
            + "\n---\n"
            + DECOMPOSER_USER_TEMPLATE.format(
                tools="browser, python_executor, file_reader, file_writer, shell, search_engine",
                query=query,
            )
        )

        raw_output = await self._call_llm(
            model=self.decomposer_model,
            system_prompt=DECOMPOSER_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.3,
        )

        # 解析 JSON（处理 LLM 输出中的 markdown 代码块包裹）
        parsed = self._parse_json_output(raw_output)

        task_id = f"task_{uuid.uuid4().hex[:8]}"
        dag = TaskDAG(
            task_id=task_id,
            original_query=query,
            intent=intent,
            subtasks=[Subtask.model_validate(s) for s in parsed["subtasks"]],
            parallel_groups=parsed["parallel_groups"],
        )

        logger.info(f"Decomposed '{query[:50]}...' → {len(dag.subtasks)} subtasks")
        return dag

    @staticmethod
    def _build_few_shot() -> str:
        """构建 few-shot 示例文本。"""
        lines = ["以下是几个任务拆分的示例:\n"]
        for i, example in enumerate(FEW_SHOT_EXAMPLES, 1):
            lines.append(f"[示例 {i}]")
            lines.append(f"用户: {example['query']}")
            lines.append(f"输出: {json.dumps(example['output'], ensure_ascii=False, indent=2)}")
            lines.append("")
        return "\n".join(lines)

    @staticmethod
    def _parse_json_output(raw: str) -> dict:
        """从 LLM 输出中提取 JSON。"""
        # 尝试直接解析
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        # 尝试提取 ```json ... ``` 代码块
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        # 尝试提取 { ... } 块
        match = re.search(r"\{[\s\S]*\}", raw)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

        raise ValueError(f"Failed to parse JSON from LLM output: {raw[:500]}")

    async def _call_llm(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
    ) -> str:
        """调用 LLM (OpenAI 兼容 API)。"""
        response = await self.client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
        )
        content = response.choices[0].message.content or ""
        return content.strip()
```

**Step 3: 运行测试**

Run: `pytest tests/test_meta_scheduler.py -v`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add agent_swarm/meta_scheduler.py agent_swarm/prompts/ tests/test_meta_scheduler.py
git commit -m "feat: add meta-scheduler with classify, decompose, validate"
```

---

### Task 8: Swarm Orchestrator (并行执行引擎)

**Files:**
- Create: `agent_swarm/orchestrator.py`
- Create: `tests/test_orchestrator.py`

**Step 1: 写测试**

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from agent_swarm.orchestrator import SwarmOrchestrator, ResultAggregator
from agent_swarm.models import (
    TaskDAG, Subtask, AgentConfig, SwarmState, SubtaskState, SubtaskResult
)
from agent_swarm.mcp_gateway import MCPGateway
from agent_swarm.agent_factory import AgentFactory
from agent_swarm.state_manager import StateManager


@pytest.fixture
def gateway():
    return MCPGateway()


@pytest.fixture
def factory(gateway):
    return AgentFactory(gateway=gateway)


@pytest.fixture
def state_manager():
    import tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        yield StateManager(checkpoint_dir=tmpdir)


@pytest.fixture
def sample_dag():
    config = AgentConfig(name="a", role="r", system_prompt="p", tools=["shell"])
    return TaskDAG(
        task_id="test_orch_001",
        original_query="test",
        intent="test",
        subtasks=[
            Subtask(id="t1", agent_config=config, prompt="step 1"),
            Subtask(id="t2", agent_config=config, prompt="step 2"),
            Subtask(id="t3", agent_config=config, prompt="step 3", depends_on=["t1", "t2"]),
        ],
        parallel_groups=[["t1", "t2"], ["t3"]],
    )


class TestResultAggregator:
    def test_aggregate(self):
        results = [
            SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="result1"),
            SubtaskResult(subtask_id="t2", state=SubtaskState.COMPLETED, output="result2"),
        ]
        aggregator = ResultAggregator()
        summary = aggregator.aggregate(results)

        assert "t1" in summary
        assert "result1" in summary
        assert "t2" in summary
        assert "result2" in summary

    def test_aggregate_with_failure(self):
        results = [
            SubtaskResult(subtask_id="t1", state=SubtaskState.COMPLETED, output="ok"),
            SubtaskResult(subtask_id="t2", state=SubtaskState.FAILED, error="something broke"),
        ]
        aggregator = ResultAggregator()
        summary = aggregator.aggregate(results)

        assert "FAILED" in summary
        assert "something broke" in summary


class TestSwarmOrchestrator:
    @pytest.mark.asyncio
    async def test_execute_completes_all_subtasks(self, gateway, factory, state_manager, sample_dag):
        orchestrator = SwarmOrchestrator(
            gateway=gateway,
            factory=factory,
            state_manager=state_manager,
            llm_base_url="http://localhost:11434/v1",
            llm_api_key="ollama",
        )

        # Mock agent execution
        async def mock_run_agent(agent, prompt, context):
            return SubtaskResult(
                subtask_id=agent.name,
                state=SubtaskState.COMPLETED,
                output=f"Output from {agent.name}",
            )

        with patch.object(orchestrator, "_run_single_agent", side_effect=mock_run_agent):
            state = await orchestrator.execute(sample_dag)

            assert state.current_group == 2  # all groups processed
            assert all(
                r.state == SubtaskState.COMPLETED
                for r in state.subtask_results.values()
            )

    @pytest.mark.asyncio
    async def test_resume_from_checkpoint(self, gateway, factory, state_manager, sample_dag):
        orchestrator = SwarmOrchestrator(
            gateway=gateway,
            factory=factory,
            state_manager=state_manager,
            llm_base_url="http://localhost:11434/v1",
            llm_api_key="ollama",
        )

        # Pre-populate a checkpoint (simulate group 1 completed)
        state = state_manager.initialize("test_orch_001", sample_dag)
        state.subtask_results["t1"] = SubtaskResult(
            subtask_id="t1", state=SubtaskState.COMPLETED, output="done"
        )
        state.subtask_results["t2"] = SubtaskResult(
            subtask_id="t2", state=SubtaskState.COMPLETED, output="done"
        )
        state.current_group = 1
        state_manager.checkpoint(state)

        async def mock_run_agent(agent, prompt, context):
            return SubtaskResult(
                subtask_id=agent.name,
                state=SubtaskState.COMPLETED,
                output=f"Output from {agent.name}",
            )

        with patch.object(orchestrator, "_run_single_agent", side_effect=mock_run_agent):
            resumed_state = await orchestrator.resume("test_orch_001")

            assert resumed_state.current_group == 2
            assert resumed_state.subtask_results["t1"].state == SubtaskState.COMPLETED
            assert resumed_state.subtask_results["t3"].state == SubtaskState.COMPLETED
```

**Step 2: 实现 orchestrator.py**

```python
"""Swarm Orchestrator - 并行执行引擎，按 DAG 中的 parallel_groups 调度 Agent 执行。"""

import asyncio
import logging
from openai import AsyncOpenAI

from agent_swarm.models import (
    TaskDAG, SwarmState, SubtaskResult, SubtaskState, AgentConfig
)
from agent_swarm.mcp_gateway import MCPGateway
from agent_swarm.agent_factory import AgentFactory, Agent
from agent_swarm.state_manager import StateManager

logger = logging.getLogger(__name__)


class ResultAggregator:
    """汇总所有子任务结果，生成最终输出。"""

    def aggregate(self, results: list[SubtaskResult]) -> str:
        """将子任务结果汇总为自然语言摘要。"""
        parts = []

        for r in results:
            header = f"## Subtask: {r.subtask_id} [{r.state.value}]"
            parts.append(header)

            if r.state == SubtaskState.COMPLETED and r.output:
                parts.append(r.output)
            elif r.state == SubtaskState.FAILED:
                parts.append(f"**FAILED**: {r.error}")

            parts.append("")  # blank line separator

        # Add summary header
        completed = sum(1 for r in results if r.state == SubtaskState.COMPLETED)
        failed = sum(1 for r in results if r.state == SubtaskState.FAILED)
        summary = f"# Result Summary\n\n{completed}/{len(results)} subtasks completed"
        if failed:
            summary += f", {failed} failed"

        return summary + "\n\n" + "\n".join(parts)


class SwarmOrchestrator:
    """集群编排器: 按 parallel_groups 逐组并行执行子任务。

    每个 Agent 通过 LLM (OpenAI 兼容 API) 执行推理和工具调用。
    每完成一个 parallel_group，自动 checkpoint 状态。

    用法:
        orch = SwarmOrchestrator(gateway, factory, state_manager,
                                  llm_base_url="...", llm_api_key="...")
        state = await orch.execute(dag)
    """

    def __init__(
        self,
        gateway: MCPGateway,
        factory: AgentFactory,
        state_manager: StateManager,
        llm_base_url: str,
        llm_api_key: str,
    ):
        self.gateway = gateway
        self.factory = factory
        self.state_manager = state_manager
        self.llm = AsyncOpenAI(base_url=llm_base_url, api_key=llm_api_key)
        self.aggregator = ResultAggregator()

    async def execute(self, dag: TaskDAG) -> SwarmState:
        """执行完整的 DAG。"""
        state = self.state_manager.initialize(dag.task_id, dag)

        while state.current_group < len(dag.parallel_groups):
            group = dag.parallel_groups[state.current_group]
            logger.info(
                f"Executing group {state.current_group + 1}/{len(dag.parallel_groups)}: {group}"
            )

            # 并行执行当前组的所有 Agent
            tasks = []
            for subtask_id in group:
                subtask = self._find_subtask(dag, subtask_id)
                agent = self.factory.create(subtask.agent_config)
                # 收集依赖子任务的输出作为上下文
                context = self._gather_context(state, subtask.depends_on)
                tasks.append(self._run_single_agent(agent, subtask.prompt, context))

            results: list[SubtaskResult] = await asyncio.gather(*tasks)

            # 更新状态
            for result in results:
                state = self.state_manager.update_subtask(state, result)

            # Checkpoint
            self.state_manager.checkpoint(state)

            # 推进到下一组
            state = self.state_manager.advance_group(state)

        # 清理旧 checkpoint，只保留最后 3 个
        self.state_manager.cleanup(dag.task_id, keep_latest=3)

        return state

    async def resume(self, task_id: str) -> SwarmState:
        """从 checkpoint 恢复并继续执行。"""
        state = self.state_manager.resume(task_id)
        dag = state.dag

        while state.current_group < len(dag.parallel_groups):
            group = dag.parallel_groups[state.current_group]
            logger.info(
                f"Resuming group {state.current_group + 1}/{len(dag.parallel_groups)}: {group}"
            )

            tasks = []
            for subtask_id in group:
                subtask = self._find_subtask(dag, subtask_id)
                agent = self.factory.create(subtask.agent_config)
                context = self._gather_context(state, subtask.depends_on)
                tasks.append(self._run_single_agent(agent, subtask.prompt, context))

            results = await asyncio.gather(*tasks)

            for result in results:
                state = self.state_manager.update_subtask(state, result)

            self.state_manager.checkpoint(state)
            state = self.state_manager.advance_group(state)

        self.state_manager.cleanup(task_id, keep_latest=3)
        return state

    async def _run_single_agent(
        self, agent: Agent, prompt: str, context: str = ""
    ) -> SubtaskResult:
        """运行单个 Agent 完成子任务。

        使用 LLM function calling 让 Agent 调用工具。
        """
        messages = [{"role": "system", "content": agent.system_prompt}]

        if context:
            messages.append({
                "role": "system",
                "content": f"上游Agent的输出（参考上下文）:\n{context}",
            })

        messages.append({"role": "user", "content": prompt})

        # 准备工具定义
        tools = []
        for tool_name in agent.tool_names():
            try:
                schema = self.gateway.get_schema(tool_name)
                tools.append({
                    "type": "function",
                    "function": {
                        "name": schema["name"],
                        "description": schema["description"],
                        "parameters": {
                            "type": "object",
                            "properties": schema["parameters"],
                            "required": list(schema["parameters"].keys()),
                        },
                    },
                })
            except KeyError:
                logger.warning(f"Tool '{tool_name}' not found, skipping")

        iteration = 0
        final_output = ""

        while iteration < agent.max_iterations:
            iteration += 1

            try:
                if tools:
                    response = await self.llm.chat.completions.create(
                        model=agent.model,
                        messages=messages,
                        tools=tools,
                        tool_choice="auto",
                        temperature=0.3,
                    )
                else:
                    response = await self.llm.chat.completions.create(
                        model=agent.model,
                        messages=messages,
                        temperature=0.3,
                    )

                choice = response.choices[0]
                msg = choice.message

                # 如果有工具调用
                if msg.tool_calls:
                    for tool_call in msg.tool_calls:
                        func_name = tool_call.function.name
                        try:
                            func_args = __import__("json").loads(tool_call.function.arguments)
                        except Exception:
                            func_args = {}

                        logger.info(f"  Agent '{agent.name}' calls tool: {func_name}")

                        try:
                            tool_result = await self.gateway.call(func_name, **func_args)
                            tool_result_str = str(tool_result)
                        except Exception as e:
                            tool_result_str = f"Tool call failed: {e}"

                        messages.append({
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": tool_call.id,
                                    "type": "function",
                                    "function": {
                                        "name": func_name,
                                        "arguments": tool_call.function.arguments,
                                    },
                                }
                            ],
                        })
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": tool_result_str[:8000],  # truncate
                        })
                else:
                    # 最终回答
                    final_output = msg.content or ""
                    messages.append({"role": "assistant", "content": final_output})
                    break

            except Exception as e:
                logger.error(f"Agent '{agent.name}' error at iteration {iteration}: {e}")
                return SubtaskResult(
                    subtask_id=agent.name,
                    state=SubtaskState.FAILED,
                    error=str(e),
                    iterations_used=iteration,
                )

        if not final_output and messages:
            # 如果达到 max_iterations 还没有最终输出，取最后一条 assistant 消息
            for m in reversed(messages):
                if m["role"] == "assistant" and m.get("content"):
                    final_output = m["content"]
                    break

        return SubtaskResult(
            subtask_id=agent.name,
            state=SubtaskState.COMPLETED if final_output else SubtaskState.FAILED,
            output=final_output or "No output generated",
            iterations_used=iteration,
        )

    @staticmethod
    def _find_subtask(dag: TaskDAG, subtask_id: str):
        """在 DAG 中查找子任务。"""
        for s in dag.subtasks:
            if s.id == subtask_id:
                return s
        raise KeyError(f"Subtask '{subtask_id}' not found in DAG")

    @staticmethod
    def _gather_context(state: SwarmState, depends_on: list[str]) -> str:
        """收集依赖子任务的输出作为上下文。"""
        parts = []
        for dep_id in depends_on:
            if dep_id in state.subtask_results:
                result = state.subtask_results[dep_id]
                if result.output:
                    parts.append(f"[{dep_id}]: {result.output}")
        return "\n\n".join(parts)
```

**Step 3: 运行测试**

Run: `pytest tests/test_orchestrator.py -v`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add agent_swarm/orchestrator.py tests/test_orchestrator.py
git commit -m "feat: add swarm orchestrator with parallel execution"
```

---

### Task 9: 集成示例与端到端验证

**Files:**
- Create: `examples/basic_usage.py`
- Update: `agent_swarm/__init__.py`

**Step 1: 创建集成示例**

```python
"""AgentSwarm 基础使用示例。

使用前确保:
1. 本地已启动 Ollama: ollama serve
2. 已拉取模型: ollama pull qwen3:4b && ollama pull qwen3:14b
"""

import asyncio
import logging
from agent_swarm import (
    MetaScheduler,
    SwarmOrchestrator,
    AgentFactory,
    MCPGateway,
    StateManager,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    # ── 初始化 ──
    gateway = MCPGateway()
    factory = AgentFactory(gateway=gateway, default_model="qwen3:14b")
    state_manager = StateManager()

    scheduler = MetaScheduler(
        base_url="http://localhost:11434/v1",
        api_key="ollama",
        classifier_model="qwen3:4b",
        decomposer_model="qwen3:14b",
    )

    orchestrator = SwarmOrchestrator(
        gateway=gateway,
        factory=factory,
        state_manager=state_manager,
        llm_base_url="http://localhost:11434/v1",
        llm_api_key="ollama",
    )

    # ── 执行 ──
    query = "调研2025年国产AI芯片市场并生成分析报告"
    logger.info(f"Processing: {query}")

    # Step 1: Meta-Scheduler 分解任务
    dag = await scheduler.process(query)
    logger.info(f"Intent: {dag.intent}")
    logger.info(f"Subtask count: {len(dag.subtasks)}")
    logger.info(f"Parallel groups: {dag.parallel_groups}")

    # 打印 Agent 配置
    for subtask in dag.subtasks:
        ac = subtask.agent_config
        logger.info(f"  [{subtask.id}] {ac.name} ({ac.role}): {ac.tools}")

    # Step 2: Orchestrator 执行
    state = await orchestrator.execute(dag)

    # Step 3: 汇总结果
    results = list(state.subtask_results.values())
    summary = orchestrator.aggregator.aggregate(results)

    print("\n" + "=" * 60)
    print(summary)
    print("=" * 60)

    # 统计
    completed = sum(1 for r in results if r.state.value == "completed")
    failed = sum(1 for r in results if r.state.value == "failed")
    logger.info(f"Done: {completed} completed, {failed} failed")


if __name__ == "__main__":
    asyncio.run(main())
```

**Step 2: 更新 __init__.py**

```python
"""AgentSwarm - AI-driven task decomposition and parallel agent execution."""

from agent_swarm.models import (
    TaskDAG, Subtask, AgentConfig, SwarmState,
    SubtaskState, SubtaskResult,
)
from agent_swarm.meta_scheduler import MetaScheduler, Router
from agent_swarm.orchestrator import SwarmOrchestrator, ResultAggregator
from agent_swarm.agent_factory import AgentFactory, Agent
from agent_swarm.mcp_gateway import MCPGateway, ToolDefinition
from agent_swarm.state_manager import StateManager

__version__ = "0.1.0"
__all__ = [
    # Core
    "MetaScheduler",
    "Router",
    "SwarmOrchestrator",
    "ResultAggregator",
    "AgentFactory",
    "Agent",
    "MCPGateway",
    "ToolDefinition",
    "StateManager",
    # Models
    "TaskDAG",
    "Subtask",
    "AgentConfig",
    "SwarmState",
    "SubtaskState",
    "SubtaskResult",
]
```

**Step 3: 运行完整测试套件**

Run: `pytest tests/ -v`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add examples/ agent_swarm/__init__.py
git commit -m "feat: add usage example and finalize public API"
```

---

## 项目结构总结

```
agnetSwarm/
├── pyproject.toml
├── agent_swarm/
│   ├── __init__.py
│   ├── models.py                # Pydantic 数据模型
│   ├── meta_scheduler.py        # IntentClassifier + Decomposer + Router
│   ├── orchestrator.py          # SwarmOrchestrator + ResultAggregator
│   ├── agent_factory.py         # 动态 Agent 实例化
│   ├── mcp_gateway.py           # MCP 工具网关
│   ├── state_manager.py         # 状态管理 + Checkpoint
│   └── prompts/
│       ├── __init__.py
│       ├── classifier.py        # IntentClassifier Prompt
│       └── decomposer.py        # Decomposer Prompt + Few-shot
├── examples/
│   └── basic_usage.py
├── tests/
│   ├── test_models.py
│   ├── test_mcp_gateway.py
│   ├── test_agent_factory.py
│   ├── test_state_manager.py
│   ├── test_meta_scheduler.py
│   └── test_orchestrator.py
└── docs/
    └── plans/
        └── 2026-07-04-agnetSwarm-design.md
```

## 依赖

- `pydantic>=2.0` — 数据模型
- `openai>=1.0` — LLM API 调用（OpenAI 兼容）
- `swarms>=6.0` — 底层编排（二期引入，一期用 asyncio）

## 执行顺序

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9

Tasks 1-2 可并行，Tasks 3-6 可并行（均不相互依赖），Tasks 7-9 需顺序。
