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
