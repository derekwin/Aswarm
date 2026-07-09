"""Tool Registry — compatibility wrapper around MCPGateway for agent tool orchestration.

All tool implementations live in MCPGateway. This module provides the
orchestrator-facing API with `schema()` and `schemas_for_llm()` methods.
"""

from typing import Any

from agent_swarm.mcp_gateway import MCPGateway


class ToolRegistry(MCPGateway):
    """Tool registry for orchestrator compatibility.

    Extends MCPGateway with `schema()` (alias for get_schema) and
    `schemas_for_llm()` (OpenAI function-calling format).
    """

    def schema(self, name: str) -> dict[str, Any]:
        """Return tool schema dict. Alias for get_schema()."""
        return self.get_schema(name)

    def schemas_for_llm(self, names: list[str]) -> list[dict[str, Any]]:
        """Return tools in OpenAI function-calling format with correct required params."""
        result: list[dict[str, Any]] = []
        for name in names:
            try:
                s = self.schema(name)
                tool = self._tools[name]
                result.append({
                    "type": "function",
                    "function": {
                        "name": s["name"],
                        "description": s["description"],
                        "parameters": {
                            "type": "object",
                            "properties": s["parameters"],
                            "required": tool.required_params,
                        },
                    },
                })
            except KeyError:
                continue
        return result
