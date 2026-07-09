"""LLM Client — OpenAI-compatible API abstraction with retry, error handling,
token counting, and budget enforcement.

Anti-corruption layer between business logic and external LLM providers.
"""

import asyncio
import logging
from typing import Any

from openai import APITimeoutError, AsyncOpenAI
from openai.types.chat import ChatCompletionMessage

logger = logging.getLogger(__name__)

RETRYABLE = (APITimeoutError, asyncio.TimeoutError, ConnectionError, ConnectionRefusedError, ConnectionResetError)


class BudgetExceededError(Exception):
    """Raised when the token budget has been exhausted."""
    pass


class LLMClient:
    """Encapsulates LLM API calls with exponential backoff retry, token counting,
    and budget enforcement.

    Usage:
        client = LLMClient(base_url="http://localhost:11434/v1", api_key="ollama")
        response = await client.chat("qwen3.5:35b", messages, tools=tools)
    """

    def __init__(self, base_url: str, api_key: str, max_retries: int = 3):
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        self.max_retries = max_retries
        self._budget: Any = None  # BudgetTracker, set externally

    def set_budget(self, budget: Any):
        self._budget = budget

    async def chat(self, model: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None,
                   temperature: float = 0.3, tool_choice: str = "auto") -> ChatCompletionMessage:
        """Send chat completion with retry. Returns the response choice message.

        Raises BudgetExceededError if the token budget has been exhausted.
        """
        if self._budget and self._budget.blocked:
            raise BudgetExceededError(
                f"Budget exhausted ({self._budget.total_tokens}/{self._budget.token_limit} tokens, "
                f"est. ${self._budget.estimated_cost:.2f})"
            )

        # Check for model degradation
        actual_model = model
        if self._budget and self._budget.should_degrade():
            actual_model = self._budget.get_degraded_model(model)
            if actual_model != model:
                logger.warning(f"Budget degrade: {model} → {actual_model} ({self._budget.usage_pct()*100:.0f}% used)")
                self._budget.degraded = True

        kwargs: dict[str, Any] = {"model": actual_model, "messages": messages, "temperature": temperature}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice

        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                response = await self._client.chat.completions.create(**kwargs)
                msg = response.choices[0].message

                # Record token usage
                if self._budget:
                    usage = getattr(response, "usage", None)
                    if usage:
                        tokens = getattr(usage, "total_tokens", 0)
                        if tokens > 0:
                            self._budget.record_usage(tokens, actual_model)
                            warn_msg = self._budget.check_and_warn()
                            if warn_msg and self._budget.blocked:
                                logger.warning(warn_msg)
                            # Check budget exhaustion — this call's response is still returned
                            # but next call will be blocked

                return msg
            except BudgetExceededError:
                raise  # don't retry budget exhaustion
            except RETRYABLE as e:
                last_error = e
                wait = 2 ** attempt
                logger.warning(f"LLM retry {attempt + 1}/{self.max_retries}: {e}. Waiting {wait}s...")
                await asyncio.sleep(wait)
            except Exception:
                raise  # non-retryable, propagate immediately
        raise RuntimeError(f"LLM call failed after {self.max_retries} retries") from last_error
