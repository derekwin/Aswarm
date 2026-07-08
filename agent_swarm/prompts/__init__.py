"""Prompt templates for AgentSwarm."""

from agent_swarm.prompts.decomposer import (
    DECOMPOSER_SYSTEM_PROMPT,
    DECOMPOSER_SYSTEM_PROMPT_ZH,
    DECOMPOSER_USER_TEMPLATE,
    load_few_shot_examples,
)

__all__ = [
    "DECOMPOSER_SYSTEM_PROMPT",
    "DECOMPOSER_SYSTEM_PROMPT_ZH",
    "DECOMPOSER_USER_TEMPLATE",
    "load_few_shot_examples",
]
