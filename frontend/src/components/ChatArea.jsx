import { useRef, useEffect, useState } from 'react'
import { useApp } from '../App'

export default function ChatArea() {
  const { state, t, dispatch, runTask } = useApp()
  const ref = useRef(null)
  const conv = state.activeConvId ? state.conversations[state.activeConvId] : null
  const [editingIdx, setEditingIdx] = useState(null)
  const [editText, setEditText] = useState('')

  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [conv?.messages, state.agentStates])

  const startEdit = (idx, text) => { setEditingIdx(idx); setEditText(text) }
  const cancelEdit = () => setEditingIdx(null)

  const submitEdit = async () => {
    const text = editText.trim(); if (!text || !conv) return
    setEditingIdx(null)
    await runTask(state.activeConvId, text)
  }

  if (!conv || !conv.messages?.length) {
    return (
      <div className="chat-area">
        <div className="empty-state">
          <div className="icon">✦</div>
          <h2>{t('emptyTitle')}</h2>
          <p>{t('emptyDesc')}</p>
          <div className="suggestion-chips">
            <button className="suggestion-chip" onClick={() => { const el = document.getElementById('queryInput'); if (el) { el.value = '调研2025年国产AI芯片市场并生成分析报告'; el.focus() } }}>国产芯片市场调研</button>
            <button className="suggestion-chip" onClick={() => { const el = document.getElementById('queryInput'); if (el) { el.value = '对比分析 React 和 Vue 在2025年的生态和发展趋势'; el.focus() } }}>React vs Vue</button>
            <button className="suggestion-chip" onClick={() => { const el = document.getElementById('queryInput'); if (el) { el.value = '写一篇关于大语言模型发展的技术报告'; el.focus() } }}>LLM报告</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-area" ref={ref}>
      {conv.messages.map((m, i) => (
        <div key={i} className={'message fade-up ' + (m.role === 'user' ? 'user user-bubble-wrapper' : 'assistant')}>
          <div className={'avatar ' + m.role}>{m.role === 'user' ? 'U' : 'S'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingIdx === i ? (
              <div className={'bubble ' + m.role} style={{ padding: 0, background: 'transparent', border: 'none' }}>
                <textarea
                  className="edit-input"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  rows={Math.min(editText.split('\n').length + 1, 8)}
                  style={{ width: '100%', minHeight: 60 }}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitEdit() }}
                />
                <div className="edit-actions">
                  <button className="save-btn" onClick={submitEdit}>Re-run</button>
                  <button className="cancel-btn" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className={'bubble ' + m.role}>
                {m.typing
                  ? <span className="typing">{t('classifying')}</span>
                  : m.content && m.content.startsWith('<')
                    ? <span dangerouslySetInnerHTML={{ __html: m.content }} />
                    : <span dangerouslySetInnerHTML={{ __html: mdRender(m.content || '') }} />
                }
              </div>
            )}
            {m.dag && editingIdx !== i && <div className="dag-container"><DAGView data={m.dag} /></div>}
            {m.dag && editingIdx !== i && <AgentStepper />}
            {m.dag && editingIdx !== i && <ActivityFeed />}
            {m.role === 'user' && editingIdx !== i && (
              <div className="bubble-actions">
                <button className="bubble-action-btn" onClick={() => startEdit(i, m.content)}>✎ Edit</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function ActivityFeed() {
  const { state } = useApp()
  const conv = state.activeConvId ? state.conversations[state.activeConvId] : null
  const activity = conv?.activity || []
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [activity.length])
  if (!activity.length) return null

  const toolIcons = { search_engine: '🔍', webfetch: '🌐', python_executor: '🐍', file_writer: '📝', file_reader: '📖', browser: '🖥', shell: '💻' }

  return (
    <div style={{ marginTop: 12, background: 'var(--bg-deeper)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>⚡ Live Activity</span>
        <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 4, background: 'var(--accent-glow)', color: 'var(--accent)' }}>{activity.length}</span>
      </div>
      <div ref={ref} style={{ maxHeight: 200, overflowY: 'auto', padding: '4px 0' }}>
        {activity.map((a, i) => (
          <div key={i} className="fade-up" style={{ padding: '4px 14px', fontSize: '0.7rem', color: 'var(--text-secondary)', borderLeft: '2px solid var(--accent)', marginLeft: 8, marginBottom: 2 }}>
            <span style={{ fontWeight: 500, color: 'var(--text)' }}>{a.agent}</span>
            <span style={{ color: 'var(--text-tertiary)', margin: '0 4px' }}>→</span>
            <span>{toolIcons[a.tool] || '🔧'}</span>
            <span style={{ fontWeight: 500 }}>{a.tool}</span>
            <span style={{ color: 'var(--text-tertiary)', marginLeft: 6, fontSize: '0.65rem' }}>{a.args?.slice(0, 80)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function mdRender(text) {
  if (!text) return ''
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<div class="md-codeblock">$2</div>')
    .replace(/\*\*(.+?)\*\*\s*/g, '<span class="md-bold">$1</span>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\n/g, '<br>')
}

function DAGView({ data }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    const render = () => {
      try {
        let mm = 'graph LR\n'
        const colors = ['#6c5ce7', '#00d26a', '#f5a623', '#f93a3a']
        data.parallel_groups.forEach((g, gi) => {
          mm += `  subgraph G${gi + 1}[G${gi + 1}]\n    style G${gi + 1} fill:var(--bg-deeper),stroke:${colors[gi % 4]}\n`
          g.forEach(tid => { const s = data.subtasks?.find(x => x.id === tid) || {}; mm += `    ${tid}["${(s.name || tid).slice(0, 18)}"]\n` })
          mm += '  end\n'
        })
        data.subtasks?.forEach(s => s.depends_on?.forEach(d => mm += `  ${d} --> ${s.id}\n`))
        if (window.mermaid) window.mermaid.render('dag-' + Date.now(), mm).then(r => setSvg(r.svg))
      } catch (e) { }
    }
    if (!window.mermaid) {
      const s = document.createElement('script'); s.src = '/static/mermaid.min.js'
      s.onload = () => { window.mermaid?.initialize({ startOnLoad: true, theme: 'dark' }); render() }
      document.head.appendChild(s)
    } else render()
  }, [data])
  return <div dangerouslySetInnerHTML={{ __html: svg }} />
}

function AgentStepper() {
  const { state, dispatch, t } = useApp()
  const conv = state.activeConvId ? state.conversations[state.activeConvId] : null
  const agents = Object.entries(conv?.agents || {})
  if (!agents.length) return <div className="stepper"><div className="stepper-header"><span>{t('agents')}</span></div></div>
  return (
    <div className="stepper">
      <div className="stepper-header"><span>{t('agents')}</span><span className="badge">{agents.length}</span></div>
      <div className="stepper-steps">
        {agents.map(([id, a]) => (
          <div key={id} className={'step ' + a.state} onClick={() => dispatch({ type: 'SET_PANEL', payload: { ...a, name: a.name || id } })}>
            <div className="step-dot">{a.state === 'completed' ? '✓' : a.state === 'failed' ? '✗' : '·'}</div>
            <div className="step-info"><div className="step-name">{a.name || id}</div><div className="step-meta">{a.state + (a.retry ? ' · retries:' + a.retry : '')}</div></div>
          </div>
        ))}
      </div>
    </div>
  )
}
