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
