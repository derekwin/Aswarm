// Shared types for AgentSwarm frontend

export interface Agent {
  name: string;
  role: string;
  state: string;
  subtaskId: string;
  output?: string;
  error?: string;
  retries?: number;
}

export interface ChatMessage {
  role: string;
  content: string;
  id: number;
  typing?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  messages?: { role: string; content: string; id: number }[];
  task?: { id: string; status: string; intent?: string; subtaskCount?: number } | null;
}

export type SSEEvent = Record<string, unknown>;

export interface TraceEvent {
  event_type: string;
  agent_name?: string;
  subtask_id?: string;
  data: Record<string, unknown>;
}

export interface WorkspaceFile {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
}
