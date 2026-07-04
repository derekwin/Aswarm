from enum import Enum
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
    task_id: str
    dag: TaskDAG
    current_group: int = 0
    subtask_results: dict[str, SubtaskResult] = Field(default_factory=dict)
    checkpoint_path: str | None = None


class DivergenceWarning(BaseModel):
    diverged: bool = False
    current_project: str = ""
    new_task_summary: str = ""
    suggestion: str = ""
