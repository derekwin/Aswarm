"""Budget tracker — token counting, budget enforcement, and model degradation.

Lightweight version inspired by Aden Hive's cascading token bucket.
Tracks per-task token usage and enforces configurable limits with
graceful degradation to cheaper models when approaching budget.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# Estimated cost multipliers (relative to default model = 1.0)
# Higher = more expensive
MODEL_TIER_COST: dict[str, float] = {
    # Tier 0: cheapest (fallback)
    "qwen3:3b": 0.2,
    "qwen3:8b": 0.5,
    # Tier 1: default
    "qwen3:14b": 1.0,
    "qwen3.5:14b": 1.2,
    # Tier 2: expensive
    "qwen3.5:35b": 2.5,
    "qwen3:35b": 2.0,
    # OpenAI
    "gpt-4o": 5.0,
    "gpt-4o-mini": 1.0,
    "gpt-3.5-turbo": 0.5,
    # Anthropic
    "claude-3-5-sonnet": 4.0,
    "claude-3-haiku": 1.0,
    # Generic catch-all
    "default": 1.0,
}

# Degradation chain: when budget tightens, fall through these models
DEGRADATION_CHAIN = [
    "qwen3:3b",       # absolute cheapest
    "qwen3:8b",        # still cheap
    "gpt-3.5-turbo",
    "claude-3-haiku",
    "gpt-4o-mini",
    "qwen3:14b",
    "qwen3.5:14b",
    "qwen3:35b",
    "qwen3.5:35b",
    "gpt-4o",
    "claude-3-5-sonnet",
]


@dataclass
class BudgetTracker:
    """Tracks token usage and enforces budget constraints.

    Usage:
        budget = BudgetTracker(token_limit=100_000)
        budget.record_usage(1500, "qwen3:14b")  # record after each LLM call
        if budget.is_exhausted():
            ...  # block further calls
        degraded = budget.get_degraded_model("qwen3.5:35b")  # cheaper alternative
    """

    token_limit: int = 100_000          # max tokens allowed for this task
    warn_pct: float = 0.7               # warn at 70% usage
    degrade_pct: float = 0.85           # start degrading at 85% usage
    block_pct: float = 1.0              # block at 100% usage

    total_tokens: int = 0
    estimated_cost: float = 0.0
    call_count: int = 0
    warnings: list[str] = field(default_factory=list)
    degraded: bool = False
    blocked: bool = False

    def record_usage(self, tokens: int, model: str = "default"):
        """Record token consumption from an LLM call."""
        tier_cost = MODEL_TIER_COST.get(model, MODEL_TIER_COST["default"])
        self.total_tokens += tokens
        self.estimated_cost += tokens * tier_cost * 0.001  # rough: $0.001 per weighted token
        self.call_count += 1

    def usage_pct(self) -> float:
        return self.total_tokens / self.token_limit if self.token_limit else 0.0

    def is_exhausted(self) -> bool:
        return self.total_tokens >= self.token_limit * self.block_pct

    def should_warn(self) -> bool:
        return self.total_tokens >= self.token_limit * self.warn_pct and not self.warnings

    def should_degrade(self) -> bool:
        return self.total_tokens >= self.token_limit * self.degrade_pct and not self.degraded

    def check_and_warn(self) -> str:
        """Return a warning message if threshold crossed. Empty string otherwise."""
        if self.blocked:
            return ""
        if self.is_exhausted():
            self.blocked = True
            msg = f"Budget exhausted: {self.total_tokens}/{self.token_limit} tokens used across {self.call_count} calls (est. ${self.estimated_cost:.2f}). Further LLM calls blocked."
            self.warnings.append(msg)
            logger.warning(msg)
            return msg
        if self.should_degrade():
            self.degraded = True
            msg = f"Budget warning: {self.total_tokens}/{self.token_limit} tokens ({self.usage_pct()*100:.0f}%). Switching to cheaper models."
            self.warnings.append(msg)
            logger.warning(msg)
            return msg
        if self.should_warn():
            msg = f"Budget notice: {self.total_tokens}/{self.token_limit} tokens ({self.usage_pct()*100:.0f}%). Consider simplifying the task."
            self.warnings.append(msg)
            logger.info(msg)
            return msg
        return ""

    def get_degraded_model(self, current_model: str) -> str:
        """Return a cheaper model from the degradation chain.

        Finds the current model's position in the chain and returns the next
        cheaper model. If already at the cheapest, returns the cheapest.
        """
        current_lower = current_model.lower()
        # Try exact match first
        for i, m in enumerate(DEGRADATION_CHAIN):
            if m.lower() == current_lower:
                # Degrade based on configured degrade_pct and proximity to block
                if self.usage_pct() > 0.95:
                    return DEGRADATION_CHAIN[max(0, i - 3)]  # aggressive degrade
                elif self.usage_pct() > self.degrade_pct:
                    return DEGRADATION_CHAIN[max(0, i - 1)]
                return current_model
        # Model not in known chain — use cheapest available
        return DEGRADATION_CHAIN[0]

    def summary(self) -> dict[str, Any]:
        return {
            "total_tokens": self.total_tokens,
            "token_limit": self.token_limit,
            "usage_pct": round(self.usage_pct() * 100, 1),
            "estimated_cost": round(self.estimated_cost, 2),
            "call_count": self.call_count,
            "degraded": self.degraded,
            "blocked": self.blocked,
            "warnings": self.warnings[-3:],  # last 3 warnings
        }
