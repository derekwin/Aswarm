import { useState } from 'react'
import { useApp } from '../App'

export default function Sidebar() {
  const { state, dispatch, t } = useApp()
  const [filter, setFilter] = useState('')

  const newConv = async () => {
    const r = await fetch('/api/conversations?title=New+Task', { method: 'POST' })
    const c = await r.json()
    dispatch({ type: 'ADD_CONV', payload: { id: c.id, title: c.title, messages: [], time: new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), _loaded: true } })
  }

  const delConv = async (id, e) => {
    e.stopPropagation()
    if (!confirm(t('deleteConfirm'))) return
    await fetch('/api/conversations/' + id, { method: 'DELETE' })
    dispatch({ type: 'DEL_CONV', payload: id })
  }

  const switchConv = async (id) => {
    dispatch({ type: 'SET_ACTIVE', payload: id })
    dispatch({ type: 'RESET_TASK' })
    if (!state.conversations[id]._loaded) {
      const r = await fetch('/api/conversations/' + id)
      const d = await r.json()
      dispatch({ type: 'SET_MSGS', payload: { id, messages: (d.messages || []).map(m => ({ role: m.role, content: m.content })) } })
    }
  }

  const ids = Object.keys(state.conversations).filter(id =>
    state.conversations[id].title.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <>
      <div className={'sidebar-overlay' + (state.sidebarOpen ? ' show' : '')} onClick={() => dispatch({ type: 'SET_SIDEBAR_OPEN', payload: false })} />
      <aside className={'sidebar' + (state.sidebarOpen ? ' open' : '')}>
        <div className="sidebar-header">
          <div className="logo">⚡</div>
          <h2>AgentSwarm</h2>
        </div>
        <button className="new-conv-btn" onClick={newConv}>+ {t('newTask')}</button>
        <div className="conv-search">
          <input type="text" placeholder={t('searchConv')} value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <div className="conv-list">
          {ids.length === 0 && <div className="empty-conv">{t('noConvs')}</div>}
          {ids.map(id => {
            const c = state.conversations[id], active = id === state.activeConvId
            return (
              <div key={id} className={'conv-item' + (active ? ' active' : '')} onClick={() => { switchConv(id); dispatch({ type: 'SET_SIDEBAR_OPEN', payload: false }) }}>
                <div className="conv-info"><div className="conv-title">{c.title}</div><div className="conv-time">{c.time}</div></div>
                <span className="conv-delete" onClick={e => delConv(id, e)}>✕</span>
              </div>
            )
          })}
        </div>
      </aside>
    </>
  )
}
