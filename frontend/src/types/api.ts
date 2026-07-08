// Auto-generated from Pydantic models. DO NOT EDIT MANUALLY.
// Run: python scripts/generate_types.py > frontend/src/types/api.ts
//
// NOTE: This file is auto-generated but currently not used by components.
// The active SSE event types are in types/index.ts (camelCase wire format).
// Keep these types around for reference until the codebase fully migrates.

export type SubtaskState = 'pending' | 'running' | 'completed' | 'failed';

export interface AgentConfig {
  name: string;  // name
  role: string;  // role
  systemPrompt: string;  // system_prompt
  tools: string[];  // tools
  model?: string;  // model
  maxIterations?: number;  // max_iterations
}

export interface Subtask {
  id: string;  // id
  agentConfig: AgentConfig;  // agent_config
  prompt: string;  // prompt
  dependsOn?: string[];  // depends_on
}

export interface TaskDAG {
  taskId: string;  // task_id
  originalQuery: string;  // original_query
  intent: string;  // intent
  subtasks: Subtask[];  // subtasks
  parallelGroups: string[][];  // parallel_groups
}

export interface SubtaskResult {
  subtaskId: string;  // subtask_id
  state?: SubtaskState;  // state
  output?: string | null;  // output
  error?: string | null;  // error
  iterationsUsed?: number;  // iterations_used
  retryCount?: number;  // retry_count
  retryHistory?: string[];  // retry_history
}

export interface SwarmState {
  taskId: string;  // task_id
  dag: TaskDAG;  // dag
  currentGroup?: number;  // current_group
  subtaskResults?: Record<string, SubtaskResult>;  // subtask_results
  checkpointPath?: string | null;  // checkpoint_path
}

// ── SSE Event Types (wire format, snake_case) ──

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
  | { type: 'error'; msg: string; code?: string };
