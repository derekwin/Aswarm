"""LLM Client — OpenAI-compatible API abstraction with retry and error handling.

Anti-corruption layer between business logic and external LLM providers.
"""

import asyncio
import logging
from typing import Any

from openai import APITimeoutError, AsyncOpenAI
from openai.types.chat import ChatCompletionMessage

logger = logging.getLogger(__name__)

RETRYABLE = (APITimeoutError, asyncio.TimeoutError, ConnectionError, ConnectionRefusedError, ConnectionResetError)


class LLMClient:
    """Encapsulates LLM API calls with exponential backoff retry.

    Usage:
        client = LLMClient(base_url="http://localhost:11434/v1", api_key="ollama")
        response = await client.chat("qwen3.5:35b", messages, tools=tools)
    """

    def __init__(self, base_url: str, api_key: str, max_retries: int = 3):
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        self.max_retries = max_retries

    async def chat(self, model: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None,
                   temperature: float = 0.3, tool_choice: str = "auto") -> ChatCompletionMessage:
        """Send chat completion with retry. Returns the response choice message."""
        kwargs: dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice

        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                response = await self._client.chat.completions.create(**kwargs)
                return response.choices[0].message
            except RETRYABLE as e:
                last_error = e
                wait = 2 ** attempt
                logger.warning(f"LLM retry {attempt + 1}/{self.max_retries}: {e}. Waiting {wait}s...")
                await asyncio.sleep(wait)
            except Exception:
                raise  # non-retryable, propagate immediately
        raise RuntimeError(f"LLM call failed after {self.max_retries} retries") from last_error
