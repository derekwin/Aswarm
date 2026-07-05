/** AgentSwarm API service layer — all fetch calls centralized here. */

const API = {
  async get(path) { const r = await fetch(path); if (!r.ok) throw new Error(r.statusText); return r.json(); },
  async post(path, body) { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); if (!r.ok) throw new Error(r.statusText); return r.json(); },
  async put(path, body) { const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(r.statusText); return r.json(); },
  async del(path) { const r = await fetch(path, { method: 'DELETE' }); if (!r.ok) throw new Error(r.statusText); return r.json(); },

  // Conversations
  listConversations: () => API.get('/api/conversations'),
  createConversation: (title = 'New Task') => API.post(`/api/conversations?title=${encodeURIComponent(title)}`),
  getConversation: (id) => API.get(`/api/conversations/${id}`),
  deleteConversation: (id) => API.del(`/api/conversations/${id}`),

  // Tasks
  runTask: (query, convId) => API.post(`/run?query=${encodeURIComponent(query)}&conv_id=${encodeURIComponent(convId)}`),

  // Settings
  getSettings: () => API.get('/api/settings'),
  saveSettings: (data) => API.put('/api/settings', data),

  // Workspace
  listFiles: (convId) => API.get(`/api/workspace/${convId}`),
  readFile: (convId, path) => API.get(`/api/workspace/${convId}/file?path=${encodeURIComponent(path)}`),
  uploadFile: (file) => { const fd = new FormData(); fd.append('file', file); return fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json()); },

  // Sync
  sync: () => API.post('/api/sync'),
}

export default API
