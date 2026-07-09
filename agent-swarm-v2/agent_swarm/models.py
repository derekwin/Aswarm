from enum import Enum

from pydantic import BaseModel, Field


class SubtaskState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AgentConfig(BaseModel):
    """由 Decomposer 现场生成的 Agent 配置。"""
    name: str = Field(description="Unique agent name, e.g. 'gpu_market_searcher'")
    role: str = Field(description="Agent role: 'web_searcher', 'coder', 'writer', etc.")
    system_prompt: str = Field(description="Fully LLM-generated agent role definition")
    tools: list[str] = Field(description="List of tools available to this agent")
    model: str = Field(default="default", description="Optional model override (default uses system default)")
    max_iterations: int = Field(default=5, ge=1, le=100, description="Maximum reasoning iterations")


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
    retry_count: int = 0
    retry_history: list[str] = Field(default_factory=list)


class SwarmState(BaseModel):
    task_id: str
    dag: TaskDAG
    current_group: int = 0
    subtask_results: dict[str, SubtaskResult] = Field(default_factory=dict)
    checkpoint_path: str | None = None

    @property
    def completed_count(self) -> int:
        """Number of subtasks that completed successfully."""
        return sum(1 for r in self.subtask_results.values() if r.state == SubtaskState.COMPLETED)

    @property
    def failed_count(self) -> int:
        """Number of subtasks that failed."""
        return sum(1 for r in self.subtask_results.values() if r.state == SubtaskState.FAILED)


class DivergenceWarning(BaseModel):
    diverged: bool = False
    current_project: str = ""
    new_task_summary: str = ""
    suggestion: str = "Consider creating a separate project for this task."
