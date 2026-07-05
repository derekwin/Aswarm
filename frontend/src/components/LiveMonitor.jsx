import { useApp } from '../App'
import { useState, useEffect } from 'react'

export default function LiveMonitor() {
  const { state, dispatch } = useApp()
  const [tab, setTab] = useState('agents')
  const [files, setFiles] = useState([])
  const [viewFile, setViewFile] = useState(null)

  const convId = state.activeConvId
  const conv = convId ? state.conversations[convId] : null
  const agents = Object.values(conv?.agents || {})
  const totalAgents = conv?.totalAgents || 0
  const completedAgents = conv?.completedAgents || 0
  const pct = totalAgents ? Math.round(completedAgents / totalAgents * 100) : 0

  useEffect(() => {
    if (tab === 'files' && convId) {
      fetch('/api/workspace/' + convId).then(r => r.json()).then(d => setFiles(d.files || [])).catch(() => {})
    }
  }, [tab, convId, done]) // refresh when agents complete

  const openFile = async (path) => {
    const r = await fetch('/api/workspace/' + convId + '/file?path=' + encodeURIComponent(path))
    const d = await r.json()
    setViewFile(d)
  }

  const downloadFile = (path) => {
    window.open('/api/workspace/' + convId + '/download?path=' + encodeURIComponent(path), '_blank')
  }

  return (
    <>
      <div className="live-monitor open" style={{ width: 320, borderLeft: '1px solid var(--border)', position: 'relative' }}>
        <div className="monitor-toggle" style={{ position: 'absolute', right: '100%', top: '50%' }} onClick={() => dispatch({ type: 'SET_MONITOR', payload: false })}>
          <span>▶</span>
        </div>
        <div className="monitor-inner" style={{ width: 320 }}>
          <div className="monitor-header">
            <h3>Live Monitor</h3>
            <span className="monitor-summary">{completedAgents}/{totalAgents}</span>
          </div>
          <div className="monitor-progress"><div className="monitor-progress-fill" style={{ width: pct + '%' }} /></div>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            {['agents','files'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ flex:1, padding:'8px', border:'none', background: tab===t?'var(--surface)':'none', color: tab===t?'var(--text)':'var(--text-secondary)', cursor:'pointer', fontSize:'0.75rem', fontWeight:500, borderBottom: tab===t?'2px solid var(--accent)':'2px solid transparent', transition:'all 0.15s' }}>
                {t === 'agents' ? 'Agents' : 'Files'}
              </button>
            ))}
          </div>
          {tab === 'agents' ? (
            <div className="monitor-agents">
              {agents.length === 0 && <div className="empty-conv" style={{ padding: 16 }}>No agents running</div>}
              {agents.map((a, i) => (
                <div key={a.name + i} className={'monitor-agent-card ' + a.state}>
                  <div className="monitor-agent-icon" style={a.state==='completed'?{background:'var(--green)',borderColor:'var(--green)',color:'#fff'}:a.state==='failed'?{background:'var(--red)',borderColor:'var(--red)',color:'#fff'}:a.state==='running'?{borderColor:'var(--accent)',color:'var(--accent)',animation:'pulse-dot 1.2s infinite'}:{}}>
                    {a.state === 'completed' ? '✓' : a.state === 'failed' ? '✗' : '·'}
                  </div>
                  <div className="monitor-agent-info">
                    <div className="monitor-agent-name">{a.name || 'Agent'}</div>
                    <div className="monitor-agent-action">{a.state + (a.retry ? ' · ' + a.retry + ' retries' : '')}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="monitor-agents">
              {files.length === 0 && <div className="empty-conv" style={{ padding: 16 }}>No files yet</div>}
              {files.map(f => (
                <div key={f.path} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:6, cursor:'pointer', fontSize:'0.7rem', color:'var(--text-secondary)', transition:'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background='var(--hover-row)'} onMouseLeave={e => e.currentTarget.style.background='none'}
                  onClick={() => f.type === 'file' ? openFile(f.path) : null}>
                  <span>{f.type === 'dir' ? '📁' : '📄'}</span>
                  <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</span>
                  {f.type === 'file' && <span style={{fontSize:'0.6rem',color:'var(--text-muted)'}}>{formatSize(f.size)}</span>}
                  {f.type === 'file' && <button onClick={e => {e.stopPropagation();downloadFile(f.path)}} style={{padding:'2px 6px',border:'1px solid var(--border)',borderRadius:4,background:'none',color:'var(--text-secondary)',cursor:'pointer',fontSize:'0.6rem'}}>⬇</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* File viewer modal */}
      {viewFile && (
        <div className="modal open" onClick={() => setViewFile(null)}>
          <div className="modal-content" style={{ maxWidth: '48rem', maxHeight: '80vh', display:'flex', flexDirection:'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize:'0.85rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{viewFile.path}</h2>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => downloadFile(viewFile.path)} style={{ padding:'4px 12px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text-secondary)', cursor:'pointer', fontSize:'0.75rem' }}>⬇ Download</button>
                <button className="modal-close" onClick={() => setViewFile(null)}>✕</button>
              </div>
            </div>
            <div style={{ flex:1, overflow:'auto', padding:16, background:'var(--bg-deeper)', borderRadius:8, fontSize:'0.75rem', lineHeight:1.6, whiteSpace:'pre-wrap', fontFamily:'monospace', color:'var(--text-secondary)' }}>
              {viewFile.binary ? viewFile.content : (viewFile.content || '(empty)')}
            </div>
            {!viewFile.binary && <div style={{ padding:'4px 0 0', fontSize:'0.65rem', color:'var(--text-muted)' }}>{viewFile.content?.length || 0} chars · {formatSize(viewFile.size)}</div>}
          </div>
        </div>
      )}
    </>
  )
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}
