"""Prompt templates for AgentSwarm."""

from agent_swarm.prompts.classifier import CLASSIFIER_SYSTEM_PROMPT, CLASSIFIER_USER_TEMPLATE
from agent_swarm.prompts.decomposer import (
    DECOMPOSER_SYSTEM_PROMPT,
    DECOMPOSER_USER_TEMPLATE,
    FEW_SHOT_EXAMPLES,
)

__all__ = [
    "CLASSIFIER_SYSTEM_PROMPT",
    "CLASSIFIER_USER_TEMPLATE",
    "DECOMPOSER_SYSTEM_PROMPT",
    "DECOMPOSER_USER_TEMPLATE",
    "FEW_SHOT_EXAMPLES",
]
