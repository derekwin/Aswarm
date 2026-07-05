import { useState, useRef } from 'react'
import { useApp } from '../App'

export default function InputArea() {
  const { state, dispatch, t, eventSourceRef } = useApp()
  const [query, setQuery] = useState('')
  const [sending, setSending] = useState(false)
  const taRef = useRef(null)

  const autoResize = () => {
    const el = taRef.current; if (!el) return
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  const handleFile = async (e) => {
    const file = e.target.files[0]; if (!file) return
    setSending(true)
    const fd = new FormData(); fd.append('file', file)
    try {
      const r = await fetch('/api/upload', { method: 'POST', body: fd })
      const d = await r.json()
      if (d.content) { setQuery(q => q + '\n\n--- File: ' + d.filename + ' ---\n' + d.content.slice(0, 8000)); setTimeout(autoResize, 50) }
      else if (d.error) dispatch({ type: 'ADD_TOAST', payload: 'Upload failed: ' + d.error })
    } catch(e) { dispatch({ type: 'ADD_TOAST', payload: 'Upload failed' }) }
    setSending(false); e.target.value = ''
  }

  const submit = async () => {
    const q = query.trim(); if (!q || sending) return
    setSending(true); setQuery('')
    let convId = state.activeConvId

    // Create conversation if none active
    if (!convId) {
      const r = await fetch('/api/conversations?title=New+Task', { method: 'POST' })
      const c = await r.json()
      convId = c.id
      dispatch({ type: 'ADD_CONV', payload: { id: c.id, title: 'New Task', messages: [], time: new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), _loaded: true } })
    }

    // Add user message
    dispatch({ type: 'APPEND_MSG', payload: { id: convId, msg: { role: 'user', content: q } } })
    if (state.conversations[convId]?.title === 'New Task') {
      dispatch({ type: 'SET_TITLE', payload: { id: convId, title: q.slice(0, 40) } })
    }

    // Add loading assistant message with typing flag
    dispatch({ type: 'APPEND_MSG', payload: { id: convId, msg: { role: 'assistant', content: t('classifying'), typing: true } } })

    try {
      const r = await fetch('/run?query=' + encodeURIComponent(q) + '&conv_id=' + encodeURIComponent(convId), { method: 'POST' })
      const { task_id } = await r.json()
      if (eventSourceRef.current) eventSourceRef.current.close()
      dispatch({ type: 'SET_CONNECTED', payload: true })

      eventSourceRef.current = new EventSource('/stream/' + task_id)
      eventSourceRef.current.onmessage = (e) => {
        const d = JSON.parse(e.data)
        switch (d.type) {
          case 'status':
            dispatch({ type: 'UPDATE_LAST_MSG', payload: { id: convId, content: d.msg, typing: true } })
            break
          case 'dag':
            dispatch({ type: 'SET_TASK', payload: { total: d.subtasks.length } })
            dispatch({ type: 'UPDATE_LAST_MSG', payload: { id: convId, content: 'Decomposed into ' + d.subtasks.length + ' agents across ' + d.parallel_groups.length + ' groups.' } })
            // Attach DAG data to the message for rendering
            const convs = { ...state.conversations }
            const c = convs[convId]
            const msgs = [...(c.messages || [])]
            if (msgs.length) msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], dag: d }
            convs[convId] = { ...c, messages: msgs }
            dispatch({ type: 'SET_MSGS', payload: { id: convId, messages: msgs } })
            break
          case 'agent_start':
            dispatch({ type: 'UPDATE_AGENT', payload: { id: d.subtask_id, data: { state: 'running', name: d.agent_name, role: d.role } } })
            break
          case 'agent_done':
            dispatch({ type: 'UPDATE_AGENT', payload: { id: d.subtask_id, data: { state: d.state, output: d.output, error: d.error, retry: d.retry_count } } })
            if (d.state === 'completed' || d.state === 'failed') dispatch({ type: 'INC_COMPLETED' })
            break
          case 'done':
            dispatch({ type: 'SET_CONNECTED', payload: false })
            dispatch({ type: 'UPDATE_LAST_MSG', payload: { id: convId, content: d.summary || 'Complete' } })
            if (eventSourceRef.current) eventSourceRef.current.close()
            dispatch({ type: 'ADD_TOAST', payload: '✓ ' + t('complete') })
            break
          case 'error':
            dispatch({ type: 'SET_CONNECTED', payload: false })
            dispatch({ type: 'UPDATE_LAST_MSG', payload: { id: convId, content: 'Error: ' + d.msg } })
            break
        }
      }
      eventSourceRef.current.onerror = () => { dispatch({ type: 'SET_CONNECTED', payload: false }) }
    } catch (e) {
      dispatch({ type: 'SET_CONNECTED', payload: false })
      dispatch({ type: 'UPDATE_LAST_MSG', payload: { id: convId, content: t('loadError') } })
    }
    setSending(false)
  }

  return (
    <div className="input-area">
      <div className="input-wrapper">
        <label className="upload-btn" title="Upload file">
          <input type="file" accept=".pdf,.txt,.md,.py,.json,.csv" onChange={handleFile} style={{ display: 'none' }} />
          📎
        </label>
        <textarea id="queryInput" ref={taRef} value={query}
          onChange={e => { setQuery(e.target.value); autoResize() }}
          onInput={autoResize} placeholder={t('taskPlaceholder')} rows={1}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />
        <button onClick={submit} disabled={sending}>{t('send')}</button>
      </div>
    </div>
  )
}
