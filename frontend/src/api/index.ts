import type { ConvMeta, ConversationMessages, Settings } from '@/types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    throw new Error(body || res.statusText);
  }
  return res.json();
}

export const api = {
  // Conversations
  listConversations: () => request<ConvMeta[]>('/api/conversations'),
  createConversation: (title = 'New Task') =>
    request<ConvMeta>(`/api/conversations?title=${encodeURIComponent(title)}`, { method: 'POST' }),
  getConversation: (id: string) => request<ConversationMessages>(`/api/conversations/${id}`),
  deleteConversation: (id: string) => request<void>(`/api/conversations/${id}`, { method: 'DELETE' }),

  // Tasks
  runTask: (query: string, convId: string, lang?: string) =>
    request<{ task_id: string; conv_id: string }>(
      `/run?query=${encodeURIComponent(query)}&conv_id=${encodeURIComponent(convId)}${lang ? `&lang=${lang}` : ''}`,
      { method: 'POST' }
    ),
  cancelTask: (taskId: string) =>
    request<void>(`/cancel/${taskId}`, { method: 'POST' }),
  rerunSubtask: (taskId: string, subtaskId: string, prompt?: string) =>
    request<{ task_id: string; conv_id: string }>(
      `/api/rerun/${taskId}/${subtaskId}${prompt ? `?prompt=${encodeURIComponent(prompt)}` : ''}`,
      { method: 'POST' }
    ),
  getRunningTask: (convId: string) =>
    request<{ task: { id: string; status: string; intent: string; subtask_count: number; dag_data?: string } | null; agent_results: { subtask_id: string; agent_name: string; state: string; output?: string; error?: string; retry_count: number }[] }>(
      `/api/conversations/${convId}/task`
    ),

  // Settings
  getSettings: () => request<Settings>('/api/settings'),
  saveSettings: (data: Settings) =>
    request<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  // Workspace
  listFiles: (convId: string) =>
    request<{ files: { name: string; path: string; type: string; size: number }[] }>(
      `/api/workspace/${convId}`
    ),
  readFile: (convId: string, path: string) =>
    request<{ path: string; content: string }>(
      `/api/workspace/${convId}/file?path=${encodeURIComponent(path)}`
    ),

  // Upload
  uploadFile: async (file: File): Promise<{ filename: string; content: string; size: number; error?: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    return res.json();
  },

  // HITL Approval
  approveAction: (taskId: string, subtaskId: string, approved: boolean, feedback?: string) =>
    request<{ ok: boolean; approved: boolean }>(
      `/api/approve/${taskId}/${subtaskId}?approved=${approved}${feedback ? `&feedback=${encodeURIComponent(feedback)}` : ''}`,
      { method: 'POST' }
    ),
};
