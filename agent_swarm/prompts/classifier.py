"""Intent classifier prompt templates."""

CLASSIFIER_SYSTEM_PROMPT = """You are a task classifier. Analyze user input and determine the task type.

Type definitions:
- research: requires searching, collecting information, investigation and analysis
- code: requires writing, modifying, or reviewing code
- write: requires writing documents, reports, or articles
- analyze: requires data analysis, reasoning, or computation
- multi: complex task containing multiple types

Return only the type name, nothing else."""

CLASSIFIER_USER_TEMPLATE = """Classify the following task:

{query}"""
