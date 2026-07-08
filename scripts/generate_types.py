"""Generate TypeScript type definitions from Pydantic models.

Usage: python scripts/generate_types.py > frontend/src/types/api.ts
"""

import sys
import json
from agent_swarm.models import (
    SubtaskState,
    AgentConfig,
    Subtask,
    TaskDAG,
    SubtaskResult,
    SwarmState,
)

PY_TO_TS: dict[str, str] = {
    "str": "string",
    "int": "number",
    "float": "number",
    "bool": "boolean",
    "dict": "Record<string, unknown>",
    "list": "unknown[]",
    "NoneType": "null",
}


def ts_type(py_type: type) -> str:
    tname = type(py_type).__name__
    # Handle UnionType from Python 3.10+ (str | None, etc.)
    if tname == "UnionType":
        args = getattr(py_type, "__args__", ())
        non_none = [a for a in args if getattr(a, "__name__", "") != "NoneType"]
        if non_none:
            return ts_type(non_none[0]) + " | null"
        return "null"

    # Handle GenericAlias (list[str], dict[str, X], etc.)
    if tname == "GenericAlias":
        args = getattr(py_type, "__args__", ())
        origin = getattr(py_type, "__origin__", None)
        if origin is list:
            return ts_type(args[0]) + "[]" if args else "unknown[]"
        if origin is dict:
            return f"Record<{ts_type(args[0])}, {ts_type(args[1])}>" if args else "Record<string, unknown>"

    # Handle EnumType
    if tname == "EnumType":
        name = getattr(py_type, "__name__", str(py_type))
        return name

    # Handle basic types
    name = getattr(py_type, "__name__", str(py_type))
    if name in PY_TO_TS:
        return PY_TO_TS[name]

    # For complex model types (AgentConfig, Subtask, etc.)
    if hasattr(py_type, "model_fields"):
        return name

    return name


def generate_interface(model_cls, name_override: str | None = None) -> str:
    name = name_override or model_cls.__name__
    fields = model_cls.model_fields
    lines = [f"export interface {name} {{"]
    for fname, finfo in fields.items():
        ftype = ts_type(finfo.annotation)
        optional_default = not finfo.is_required()
        suffix = "?" if optional_default else ""
        # Use camelCase for frontend-facing interfaces
        camel = "".join(
            word.capitalize() if i > 0 else word
            for i, word in enumerate(fname.split("_"))
        )
        lines.append(f"  {camel}{suffix}: {ftype};  // {fname}")
    lines.append("}")
    return "\n".join(lines)


def generate_enum(enum_cls) -> str:
    values = " | ".join(f"'{v.value}'" for v in enum_cls)
    return f"export type {enum_cls.__name__} = {values};"


def generate_sse_events() -> str:
    return """// ── SSE Event Types (wire format, snake_case) ──

export interface SSESubtaskInfo {
  id: string;
  name: string;
  role: string;
  tools: string[];
  depends_on: string[];
}

export interface SSEAgentResult {
  subtask_id: string;
  state: string;
  output?: string;
  error?: string;
  retry_count: number;
}

export type SSEEvent =
  | { type: 'status'; msg: string }
  | { type: 'dag'; intent: string; subtasks: SSESubtaskInfo[]; parallel_groups: string[][] }
  | { type: 'agent_start'; subtask_id: string; agent_name: string; role: string }
  | { type: 'agent_done'; subtask_id: string; state: string; output?: string; error?: string; retry_count: number }
  | { type: 'tool_call'; agent_name: string; tool: string; args: string }
  | { type: 'done'; summary?: string; results?: SSEAgentResult[] }
  | { type: 'error'; msg: string; code?: string };"""


def main():
    out = [
        "// Auto-generated from Pydantic models. DO NOT EDIT MANUALLY.",
        "// Run: python scripts/generate_types.py > frontend/src/types/api.ts",
        "",
        generate_enum(SubtaskState),
        "",
        generate_interface(AgentConfig),
        "",
        generate_interface(Subtask),
        "",
        generate_interface(TaskDAG),
        "",
        generate_interface(SubtaskResult),
        "",
        generate_interface(SwarmState),
        "",
        generate_sse_events(),
        "",
    ]
    sys.stdout.write("\n".join(out))


if __name__ == "__main__":
    main()
