"""Domain-specific exceptions for agent swarm operations."""


class AgentSwarmError(Exception):
    """Base exception for all agent swarm errors."""
    def __init__(self, message: str, code: str, status_code: int = 500):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class AgentTimeoutError(AgentSwarmError):
    """Agent execution exceeded the maximum allowed time."""
    def __init__(self, agent_name: str, timeout_seconds: int):
        super().__init__(
            f"Agent '{agent_name}' timed out after {timeout_seconds}s",
            code="AGENT_TIMEOUT",
            status_code=504,
        )


class ToolExecutionError(AgentSwarmError):
    """A tool called by an agent failed during execution."""
    def __init__(self, tool_name: str, detail: str):
        super().__init__(
            f"Tool '{tool_name}' failed: {detail}",
            code="TOOL_EXECUTION_ERROR",
            status_code=502,
        )


class DecompositionError(AgentSwarmError):
    """Task decomposition by the LLM failed."""
    def __init__(self, detail: str):
        super().__init__(
            f"Task decomposition failed: {detail}",
            code="DECOMPOSITION_ERROR",
            status_code=502,
        )


class ConversationNotFoundError(AgentSwarmError):
    """Requested conversation does not exist."""
    def __init__(self, conv_id: str):
        super().__init__(
            f"Conversation '{conv_id}' not found",
            code="CONVERSATION_NOT_FOUND",
            status_code=404,
        )


class TaskNotFoundError(AgentSwarmError):
    """Requested task does not exist."""
    def __init__(self, task_id: str):
        super().__init__(
            f"Task '{task_id}' not found",
            code="TASK_NOT_FOUND",
            status_code=404,
        )
