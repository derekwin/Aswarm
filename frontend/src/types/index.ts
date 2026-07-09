// ── Conversations ──

export interface ConvMeta {
  id: string;
  title: string;
  created_at: string;
}

export interface ConversationMessages {
  id: string;
  title: string;
  created_at: string;
  messages: { role: string; content: string }[];
}

// ── Task Execution State Machine ──

export type TaskExecState =
  | 'idle'
  | 'connecting'
  | 'decomposing'
  | 'streaming'
  | 'reconnecting'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ── Error Codes ──

export type ErrorCode = 'TIMEOUT' | 'CONNECTION_ERROR' | 'AUTH_ERROR' | 'RATE_LIMIT' | 'PARSE_ERROR' | 'INTERNAL_ERROR';

export const ERROR_SUGGESTIONS: Record<ErrorCode, string> = {
  TIMEOUT: 'The LLM request timed out. Try again with a simpler query or check if the model server is responsive.',
  CONNECTION_ERROR: 'Cannot reach the LLM server. Verify that Ollama is running and the base URL is correct.',
  AUTH_ERROR: 'Authentication failed. Check your API key in Settings.',
  RATE_LIMIT: 'Rate limit exceeded. Wait a moment and try again.',
  PARSE_ERROR: 'The LLM returned an invalid response. Try rephrasing your query or switch to a different model.',
  INTERNAL_ERROR: 'An unexpected error occurred. Check the server logs for details.',
};

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  typing?: boolean;
}

// ── Agents ──

export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AgentState {
  name: string;
  role: string;
  state: AgentStatus;
  subtaskId?: string;
  output?: string;
  error?: string;
  retryCount: number;
}

// ── DAG ──

export interface SubtaskInfo {
  id: string;
  name: string;
  role: string;
  tools: string[];
  depends_on: string[];
}

export interface DAGData {
  intent: string;
  subtasks: SubtaskInfo[];
  parallel_groups: string[][];
}

// ── Activity ──

export interface ActivityEntry {
  agent: string;
  tool: string;
  args: string;
  time: number;
}

// ── WebSocket Events (replaces SSE) ──

export type WSEvent =
  | { type: 'status'; task_id: string; msg: string; event_id: number }
  | { type: 'exec_state'; task_id: string; state: 'decomposing' | 'streaming' | 'completed' | 'failed'; event_id: number }
  | { type: 'dag'; task_id: string; intent: string; subtasks: SubtaskInfo[]; parallel_groups: string[][]; event_id: number }
  | { type: 'agent_start'; task_id: string; subtask_id: string; agent_name: string; role: string; event_id: number }
  | { type: 'agent_done'; task_id: string; subtask_id: string; state: string; output?: string; error?: string; retry_count: number; event_id: number }
  | { type: 'tool_call'; task_id: string; agent_name: string; tool: string; args: string; event_id: number }
  | { type: 'done'; task_id: string; summary?: string; results?: unknown[]; event_id: number }
  | { type: 'progress'; task_id: string; completed: number; total: number; event_id: number }
  | { type: 'error'; task_id: string; msg: string; code?: string; event_id: number }
  | { type: 'catchup_done'; task_id: string }
  | { type: 'pong' };

/** @deprecated Use WSEvent instead. Kept for backward compat during migration. */
export type SSEEvent =
  | { type: 'status'; msg: string }
  | { type: 'exec_state'; state: 'decomposing' | 'streaming' | 'completed' | 'failed' }
  | { type: 'dag'; intent: string; subtasks: SubtaskInfo[]; parallel_groups: string[][] }
  | { type: 'agent_start'; subtask_id: string; agent_name: string; role: string }
  | { type: 'agent_done'; subtask_id: string; state: string; output?: string; error?: string; retry_count: number }
  | { type: 'tool_call'; agent_name: string; tool: string; args: string }
  | { type: 'done'; summary?: string; results?: unknown[] }
  | { type: 'progress'; completed: number; total: number }
  | { type: 'error'; msg: string; code?: string };

// ── Settings ──

export interface Settings {
  llm_base_url: string;
  llm_api_key: string;
  decomposer_model: string;
  default_model: string;
}

// ── Toast ──

export interface Toast {
  id: number;
  message: string;
}

// ── UI State ──

export type Theme = 'dark' | 'light';
export type Lang = 'zh' | 'en';
