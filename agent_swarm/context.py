"""Context Manager — smart context compression, prioritization, and injection for Agent Swarm.

Design principles:
- User instructions > task goal > upstream results > conversation history > defaults
- When exceeding token budget, compress least-relevant sections first
- Each agent gets tailored context: search agents see relevant history, code agents see sandbox info
"""

from agent_swarm.models import SubtaskResult


class ContextManager:
    """Manages multi-level context for agent execution.

    Levels (priority order):
    1. Task goal / user instruction — never compressed
    2. Upstream agent results — compressed if too long
    3. Conversation history — summarized to key facts
    4. Agent-specific: tool usage tips, error history
    5. System defaults — always replaceable
    """

    def __init__(self, max_chars: int = 3000):
        self.max_chars = max_chars

    def build(self, agent_role: str, task_prompt: str,
              upstream: list[SubtaskResult], history: list[str] = None) -> str:
        """Build optimized context string for an agent."""
        sections = []

        # Level 1: Task goal — always included, never compressed
        sections.append(("goal", f"Task: {task_prompt}"))

        # Level 2: Upstream results — compress if needed
        if upstream:
            upstream_text = self._format_upstream(upstream)
            sections.append(("upstream", upstream_text))

        # Level 3: Conversation history — summarize
        if history:
            sections.append(("history", self._summarize_history(history)))

        # Level 4: Agent tips
        tips = self._agent_tips(agent_role)
        if tips:
            sections.append(("tips", tips))

        # Fit to budget
        return self._fit_budget(sections)

    def _format_upstream(self, results: list[SubtaskResult]) -> str:
        """Format upstream results, preferring completed over failed."""
        parts = []
        for r in sorted(results, key=lambda r: 0 if r.state.value == "completed" else 1):
            if r.output and r.state.value == "completed":
                parts.append(f"[{r.subtask_id}] {r.output[:500]}")
            elif r.error:
                parts.append(f"[{r.subtask_id}] FAILED: {r.error[:200]}")
        return "\n\n".join(parts)

    def _summarize_history(self, history: list[str]) -> str:
        """Compress conversation history to key points."""
        if not history:
            return ""
        # Take last 3 exchanges, truncate each to 150 chars
        recent = history[-6:]  # 3 user + 3 assistant pairs
        return "Recent context:\n" + "\n".join(
            f"- {m[:150]}{'...' if len(m) > 150 else ''}"
            for m in recent
        )

    def _agent_tips(self, role: str) -> str:
        """Role-specific execution tips."""
        tips = {
            "web_searcher": "Search tips: try 2-3 keyword variations. Use webfetch after search_engine.",
            "data_analyst": "Available in sandbox: pandas, numpy, matplotlib. Execute code, don't just describe it.",
            "coder": "Write runnable code. Test it. Handle errors gracefully.",
            "writer": "Structure output with clear sections. Use file_writer to save results.",
            "reviewer": "Check for correctness, completeness, and edge cases. Fix issues directly.",
        }
        return tips.get(role, "")

    def _fit_budget(self, sections: list[tuple[str, str]]) -> str:
        """Fit sections into max_chars budget.
        Priority: goal > upstream > tips > history (history compressed first)"""
        budget = self.max_chars
        compression_order = ["history", "tips", "upstream", "goal"]

        # First pass: include all
        parts = []
        total = 0
        for _, text in sections:
            parts.append(text)
            total += len(text)

        if total <= budget:
            return "\n\n".join(parts)

        # Second pass: compress from lowest priority
        compressed = dict(sections)
        for level in compression_order:
            if level not in compressed:
                continue
            current_total = sum(len(v) for v in compressed.values())
            if current_total <= budget:
                break
            if level == "history":
                compressed[level] = compressed[level][:200] + "\n(history truncated)"
            elif level == "tips":
                compressed[level] = ""
            elif level == "upstream":
                compressed[level] = compressed[level][:budget // 2] + "\n(upstream results truncated)"

        return "\n\n".join(v for v in compressed.values() if v)


# Singleton-like module-level instance
_default_context = ContextManager()


def get_context() -> ContextManager:
    return _default_context
