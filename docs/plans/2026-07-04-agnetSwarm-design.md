# AgentSwarm 应用层设计文档

> 2026-07-04 | 本地可私有化部署的 Agent Swarm 架构

## 一、核心思路

像 Kimi Swarm 一样，完全让 AI 做 agent 规划、任务派发和编排：**输入自然语言任务 → AI 自动拆分为子任务 DAG → 现场发明 Agent 角色 → 并行执行 → 汇总结果**。

## 二、核心组件

| 模块 | 职责 | 关键设计 |
|------|------|---------|
| **IntentClassifier** | 一句话判断任务大类 | 轻量 Prompt，返回枚举值 |
| **Decomposer** | 拆分任务 DAG + 现场生成 Agent 配置 | 输出完整 JSON，包含 agent_config |
| **Router** | 校验 DAG 合法性、依赖无环、工具可用 | 纯逻辑，不调 LLM |
| **SwarmOrchestrator** | 按 parallel_groups 逐组并行执行 | 依赖 Swarms ConcurrentWorkflow |
| **MCPGateway** | 工具注册、发现、调用、权限 | Pydantic 强类型 Schema |

## 三、数据模型

- `AgentConfig`: Decomposer 现场生成的 Agent 配置（name, role, system_prompt, tools, model, max_iterations）
- `Subtask`: 单个子任务（id, agent_config, prompt, depends_on）
- `TaskDAG`: Decomposer 完整输出（task_id, original_query, intent, subtasks, parallel_groups）
- `SwarmState`: 运行时状态（task_id, dag, current_group, subtask_results, shared_context）

## 四、执行流程

```
用户输入 → IntentClassifier → Decomposer → Router.validate()
  → Orchestrator.execute():
      parallel_group_1 → AgentFactory.create() × N → 并行执行 → checkpoint()
      parallel_group_2 → AgentFactory.create() × N → 并行执行 → checkpoint()
      ...
  → ResultAggregator → 最终输出
```

## 五、技术选型

- **编排层**: Swarms 框架 (ConcurrentWorkflow / GraphWorkflow)
- **LLM 接入**: OpenAI 兼容 API（支持 Ollama/vLLM/云端 API）
- **Agent 创建**: 完全动态生成，不预置角色
- **语言**: Python 3.10+
- **数据校验**: Pydantic v2
- **状态存储**: JSON 文件 (MVP) → Redis + SQLite (二期)
- **并行执行**: asyncio + Swarms ConcurrentWorkflow

## 六、项目结构

```
agnetSwarm/
├── agent_swarm/
│   ├── __init__.py
│   ├── meta_scheduler.py      # IntentClassifier + Decomposer + Router
│   ├── orchestrator.py         # SwarmOrchestrator + ParallelExecutor
│   ├── agent_factory.py        # 动态 Agent 实例化
│   ├── mcp_gateway.py          # MCP 工具网关
│   ├── state_manager.py        # 状态管理 + Checkpoint
│   ├── models.py               # Pydantic 数据模型
│   └── prompts/
│       ├── __init__.py
│       ├── classifier.py       # IntentClassifier Prompt
│       └── decomposer.py       # Decomposer Prompt + Few-shot 示例
├── examples/
│   └── basic_usage.py
├── tests/
│   └── ...
├── pyproject.toml
└── docs/
    └── plans/
        └── 2026-07-04-agnetSwarm-design.md
```
