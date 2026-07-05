"""AgentSwarm 基础使用示例。

使用前确保:
1. 本地已启动 Ollama: ollama serve
2. 已拉取模型: ollama pull qwen3:4b && ollama pull qwen3.5:35b
3. 建议至少 24GB 显存/内存用于 35B 模型

演示: 项目上下文感知 — 检测到无关任务时提醒用户创建独立项目目录。
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
    factory = AgentFactory(gateway=gateway, default_model="qwen3.5:35b")
    state_manager = StateManager()

    scheduler = MetaScheduler(
        base_url="http://localhost:11434/v1",
        api_key="ollama",
        decomposer_model="qwen3.5:35b",
    )

    orchestrator = SwarmOrchestrator(
        gateway=gateway,
        factory=factory,
        state_manager=state_manager,
        llm_base_url="http://localhost:11434/v1",
        llm_api_key="ollama",
        max_subtask_retries=2,
    )

    # ── 设置项目上下文 ──
    scheduler.set_project("AgentSwarm 本地 Agent 集群系统开发")

    # ── 执行任务 ──
    query = "调研2025年国产AI芯片市场并生成分析报告"

    # 发散检查：新任务是否偏离当前项目？
    warning = scheduler.check_if_divergent(query)
    if warning and warning.diverged:
        print(f"\n⚠️  Current project: {warning.current_project}")
        print(f"   New task: {warning.new_task_summary}")
        print(f"   {warning.suggestion}")
        print()

    logger.info(f"Processing: {query}")

    dag = await scheduler.process(query)
    logger.info(f"Intent: {dag.intent}")
    logger.info(f"Subtask count: {len(dag.subtasks)}")
    logger.info(f"Parallel groups: {dag.parallel_groups}")

    for subtask in dag.subtasks:
        ac = subtask.agent_config
        logger.info(f"  [{subtask.id}] {ac.name} ({ac.role}): {ac.tools}")

    state = await orchestrator.execute(dag)

    results = list(state.subtask_results.values())
    summary = orchestrator.aggregator.aggregate(results)

    print("\n" + "=" * 60)
    print(summary)
    print("=" * 60)

    completed = sum(1 for r in results if r.state.value == "completed")
    failed = sum(1 for r in results if r.state.value == "failed")
    logger.info(f"Done: {completed} completed, {failed} failed")


if __name__ == "__main__":
    asyncio.run(main())
