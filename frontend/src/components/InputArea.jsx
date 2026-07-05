import { useState, useRef } from 'react'
import { useApp } from '../App'

export default function InputArea() {
  const { state, dispatch, t, eventSourceRef } = useApp()
  const [query, setQuery] = useState('')
  const [sending, setSending] = useState(false)
  const taRef = useRef(null)

  const autoResize = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  const handleFile = async (e) => {
    const file = e.target.files[0]; if (!file) return
    setSending(true)
    const fd = new FormData(); fd.append('file', file)
    const r = await fetch('/api/upload', { method: 'POST', body: fd })
    const d = await r.json()
    if (d.content) {
      setQuery(q => q + '\n\n--- File: ' + d.filename + ' ---\n' + d.content.slice(0, 8000))
      setTimeout(autoResize, 50)
    }
    setSending(false)
    e.target.value = ''
  }

  const submit = async () => {
    const q = query.trim(); if (!q || sending) return
    setSending(true); setQuery('')
    let convId = state.activeConvId
    if (!convId) {
      const r = await fetch('/api/conversations?title=New+Task', { method: 'POST' })
      const c = await r.json()
      convId = c.id
      dispatch({ type: 'ADD_CONV', payload: { id: c.id, title: 'New Task', messages: [], time: new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), _loaded: true } })
    }
    const conv = state.conversations[convId]
    if (conv) {
      conv.messages = [...(conv.messages||[]), { role: 'user', content: q }]
      if (conv.title === 'New Task') {
        conv.title = q.slice(0, 40)
        dispatch({ type: 'SET_TITLE', payload: { id: convId, title: conv.title } })
      }
    }
    // Add loading message
    if (conv) conv.messages = [...conv.messages, { role: 'assistant', content: '<span class="typing">' + t('classifying') + '</span>' }]
    dispatch({ type: 'SET_MSGS', payload: { id: convId, messages: conv?.messages || [] } })
    try {
      const r = await fetch('/run?query=' + encodeURIComponent(q) + '&conv_id=' + encodeURIComponent(convId), { method: 'POST' })
      const { task_id } = await r.json()
      if (eventSourceRef.current) eventSourceRef.current.close()
      eventSourceRef.current = new EventSource('/stream/' + task_id)
      dispatch({ type: 'SET_CONNECTED', payload: true })
      eventSourceRef.current.onmessage = (e) => {
        const d = JSON.parse(e.data)
        if (d.type === 'agent_start') dispatch({ type: 'UPDATE_AGENT', payload: { id: d.subtask_id, data: { state: 'running', name: d.agent_name } } })
        else if (d.type === 'agent_done') dispatch({ type: 'UPDATE_AGENT', payload: { id: d.subtask_id, data: { state: d.state, output: d.output, error: d.error, retry: d.retry_count } } })
        else if (d.type === 'dag') dispatch({ type: 'SET_TASK', payload: { total: d.subtasks.length } })
        else if (d.type === 'done') {
          dispatch({ type: 'SET_CONNECTED', payload: false })
          if (conv) conv.messages = conv.messages.map(m => m.role === 'assistant' ? { role: 'assistant', content: d.summary || 'Complete' } : m)
          dispatch({ type: 'SET_MSGS', payload: { id: convId, messages: conv?.messages || [] } })
          if (eventSourceRef.current) eventSourceRef.current.close()
        }
      }
      eventSourceRef.current.onerror = () => { dispatch({ type: 'SET_CONNECTED', payload: false }) }
    } catch (e) { dispatch({ type: 'SET_CONNECTED', payload: false }) }
    setSending(false)
  }

  return (
    <div className="input-area">
      <div className="input-wrapper">
        <label className="upload-btn" title="Upload file">
          <input type="file" accept=".pdf,.txt,.md,.py,.json,.csv" onChange={handleFile} style={{ display: 'none' }} />
          📎
        </label>
        <textarea ref={taRef} value={query} onChange={e => { setQuery(e.target.value); autoResize() }} onInput={autoResize}
          placeholder={t('taskPlaceholder')} rows={1}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />
        <button onClick={submit} disabled={sending}>{t('send')}</button>
      </div>
    </div>
  )
}
