"""Agent Factory - 根据 Decomposer 生成的 AgentConfig 动态实例化 Agent。"""

import logging

from agent_swarm.models import AgentConfig

logger = logging.getLogger(__name__)


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

    def __init__(self, available_tools: set[str], default_model: str = "qwen3:8b",
                 model_map: dict[str, str] | None = None):
        self._available_tools = available_tools
        self.default_model = default_model
        self._model_map = model_map or {}

    def create(self, config: AgentConfig) -> Agent:
        """根据配置创建 Agent 实例。"""
        # Resolve model: "default" → role-specific model → default_model
        if config.model == "default":
            model = self._model_map.get(config.role, self.default_model)
        else:
            model = config.model

        # 校验工具: 只保留已注册的工具
        valid_tools = [t for t in config.tools if t in self._available_tools]
        invalid_tools = [t for t in config.tools if t not in self._available_tools]

        if invalid_tools:
            logger.warning(
                f"Agent '{config.name}': ignoring invalid tools {invalid_tools}. "
                f"Available: {self._available_tools}"
            )

        return Agent(
            name=config.name,
            role=config.role,
            system_prompt=config.system_prompt,
            tools=valid_tools,
            model=model,
            max_iterations=config.max_iterations,
        )
