"""AgentSwarm usage example.

Prerequisites:
1. Ollama running: ollama serve
2. Models pulled: ollama pull qwen3:4b && ollama pull qwen3.5:35b
3. 24GB+ VRAM/RAM recommended for 35B model
"""

import asyncio
import logging
from agent_swarm import (
    MetaScheduler, SwarmOrchestrator, AgentFactory, MCPGateway, StateManager,
)
from agent_swarm.infrastructure.llm_client import LLMClient
from agent_swarm.infrastructure.tool_registry import ToolRegistry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    # Infrastructure
    llm = LLMClient(base_url="http://localhost:11434/v1", api_key="ollama")
    tools = ToolRegistry()
    gateway = MCPGateway()
    factory = AgentFactory(gateway=gateway, default_model="qwen3.5:35b")
    state_manager = StateManager()

    scheduler = MetaScheduler(llm=llm, decomposer_model="qwen3.5:35b")
    orchestrator = SwarmOrchestrator(
        tools=tools, factory=factory, state_manager=state_manager, llm=llm,
        max_subtask_retries=2,
    )

    scheduler.set_project("AgentSwarm agent cluster development")

    query = "Research 2025 China AI chip market and generate analysis report"
    warning = scheduler.check_if_divergent(query)
    if warning and warning.diverged:
        print(f"\nCurrent project: {warning.current_project}")
        print(f"New task: {warning.new_task_summary}")
        print(f"{warning.suggestion}\n")

    logger.info(f"Processing: {query}")

    dag = await scheduler.decompose(query)
    logger.info(f"Intent: {dag.intent}, Subtasks: {len(dag.subtasks)}, Groups: {dag.parallel_groups}")

    for subtask in dag.subtasks:
        ac = subtask.agent_config
        logger.info(f"  [{subtask.id}] {ac.name} ({ac.role}): {ac.tools}")

    state = await orchestrator.execute(dag)
    results = list(state.subtask_results.values())

    print("\n" + "=" * 60)
    print(orchestrator.aggregator.aggregate(results))
    print("=" * 60)

    completed = sum(1 for r in results if r.state.value == "completed")
    failed = sum(1 for r in results if r.state.value == "failed")
    logger.info(f"Done: {completed} completed, {failed} failed")


if __name__ == "__main__":
    asyncio.run(main())
