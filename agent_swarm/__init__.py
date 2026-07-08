"""AgentSwarm - AI-driven task decomposition and parallel agent execution."""

from agent_swarm.agent_factory import Agent, AgentFactory
from agent_swarm.mcp_gateway import MCPGateway, ToolDefinition
from agent_swarm.meta_scheduler import MetaScheduler, Router
from agent_swarm.models import (
    AgentConfig,
    ApprovalRequest,
    DivergenceWarning,
    Subtask,
    SubtaskResult,
    SubtaskState,
    SwarmState,
    TaskDAG,
)
from agent_swarm.orchestrator import ResultAggregator, SwarmOrchestrator
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
    "ApprovalRequest",
    "SwarmState",
    "SubtaskState",
    "SubtaskResult",
    "DivergenceWarning",
]
