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
    // Landing page: no conversations at all
    if (Object.keys(state.conversations).length === 0) {
    return (
      <div className="chat-area">
        <div className="empty-state">
          <div className="icon" style={{width:72,height:72,fontSize:'2rem'}}>⚡</div>
          <h2 style={{fontSize:'1.5rem'}}>AgentSwarm</h2>
          <p>{t('emptyDesc')}</p>
          <button className="new-conv-btn" onClick={async()=>{
            const r=await fetch('/api/conversations?title=New+Task',{method:'POST'})
            const c=await r.json()
            dispatch({type:'ADD_CONV',payload:{id:c.id,title:c.title,messages:[],time:new Date(c.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),_loaded:true,agents:{},totalAgents:0,completedAgents:0}})
          }} style={{padding:'12px 28px',fontSize:'0.9rem'}}>{t('startTask')}</button>
        </div>
      </div>
    )}
    // Empty active conversation
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
          <div style={editingIdx === i ? { flex: 1 } : { flex: 1, minWidth: 0 }}>
            {editingIdx === i ? (
              <div className={'bubble ' + m.role}>
                <textarea
                  className="edit-input"
                  value={editText}
                  onChange={e => { setEditText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
                  style={{ width: '100%', minWidth: 200, minHeight: 40, border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 'inherit', resize: 'none', outline: 'none', padding: 0, boxSizing: 'border-box' }}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitEdit() }}
                />
                <div className="edit-actions">
                  <button className="save-btn" onClick={submitEdit}>{t('rerun')}</button>
                  <button className="cancel-btn" onClick={cancelEdit}>{t('cancel')}</button>
                </div>
              </div>
            ) : (
              <div className={'bubble ' + m.role}>
                {m.typing
                  ? <span className="typing">{t('decomposing')}</span>
                  : m.content && m.content.startsWith('<')
                    ? <span dangerouslySetInnerHTML={{ __html: m.content }} />
                    : <span dangerouslySetInnerHTML={{ __html: mdRender(m.content || '') }} />
                }
              </div>
            )}
            {m.role === 'user' && editingIdx !== i && (
              <div className={'bubble-actions' + ((m._showActions) ? ' visible' : '')}
                   onTouchStart={(e) => { m._touchTimer = setTimeout(() => { m._showActions = true; e.currentTarget.classList.add('visible') }, 500) }}
                   onTouchEnd={() => { clearTimeout(m._touchTimer) }}
                   onTouchMove={() => { clearTimeout(m._touchTimer) }}>
                <button className="bubble-action-btn" onClick={() => startEdit(i, m.content)}>✎ {t('edit')}</button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function mdRender(text) {
  if (!text) return ''
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g,'<div class="md-codeblock">$2</div>')
    .replace(/\*\*(.+?)\*\*\s*/g,'<span class="md-bold">$1</span>')
    .replace(/`([^`]+)`/g,'<code class="md-code">$1</code>')
    .replace(/\n/g,'<br>')
}
function mermaidSafe(str, maxLen) {
  return (str || '')
    .replace(/[\[\]{}()"'`#&;:<>\\]/g, '')  // remove Mermaid-breaking chars
    .replace(/_/g, ' ')                       // underscores to spaces
    .replace(/\s+/g, ' ')                     // collapse whitespace
    .slice(0, maxLen)
    .trim() || 'Agent'
}

function InlineAgentDots() {
  const { state, dispatch } = useApp()
  const conv = state.activeConvId ? state.conversations[state.activeConvId] : null
  const agents = Object.entries(conv?.agents || {})
  if (!agents.length) return null
  return (
    <div>
      <div className="agent-dots">
        {agents.map(([id, a]) => (
          <div key={id} className="agent-dot" onClick={() => { dispatch({ type: 'SET_MONITOR', payload: true }) }}>
            <div className={'dot ' + a.state} />
            <span>{a.name || id}</span>
          </div>
        ))}
      </div>
      {!state.monitorOpen && <div className="view-monitor-btn" onClick={() => dispatch({ type: 'SET_MONITOR', payload: true })}>{t('viewMonitor')} →</div>}
    </div>
  )
}
