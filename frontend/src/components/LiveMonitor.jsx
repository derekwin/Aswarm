import { useApp } from '../App'
import { useState, useEffect, useRef, useCallback } from 'react'

export default function LiveMonitor() {
  const { state, dispatch, setMonitorWidth } = useApp()
  const [tab, setTab] = useState('agents')
  const [files, setFiles] = useState([])
  const [viewFile, setViewFile] = useState(null)
  const [detailAgent, setDetailAgent] = useState(null)
  const [expandedActivity, setExpandedActivity] = useState(null)

  const convId = state.activeConvId
  const conv = convId ? state.conversations[convId] : null
  const agents = Object.values(conv?.agents || {})
  const totalAgents = conv?.totalAgents || 0
  const completedAgents = conv?.completedAgents || 0
  const pct = totalAgents ? Math.round(completedAgents / totalAgents * 100) : 0
  const width = state.monitorWidth || 480
  const collapsed = !state.monitorOpen

  useEffect(() => {
    if (tab === 'files' && convId) {
      fetch('/api/workspace/' + convId).then(r => r.json()).then(d => setFiles(d.files || [])).catch(() => {})
    }
  }, [tab, convId, completedAgents])

  // Resize logic
  const handleRef = useRef(null)
  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (ev) => { setMonitorWidth(startW + startX - ev.clientX) }
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, setMonitorWidth])

  const toggleCollapse = () => dispatch({ type: 'SET_MONITOR', payload: collapsed })

  const openFile = async (path) => {
    const r = await fetch('/api/workspace/' + convId + '/file?path=' + encodeURIComponent(path))
    setViewFile(await r.json())
  }
  const downloadFile = (path) => window.open('/api/workspace/' + convId + '/download?path=' + encodeURIComponent(path), '_blank')

  return (
    <>
      <div className={'monitor-collapse-line' + (collapsed ? ' show' : '')} onClick={toggleCollapse} title="Open Monitor" />
      <div className={'live-monitor' + (collapsed ? ' collapsed' : '')} style={{ width: collapsed ? 6 : width }}>
        {!collapsed && <div className="monitor-resize-handle" ref={handleRef} onMouseDown={onMouseDown} />}
        <div className="monitor-toggle-collapse" onClick={toggleCollapse} style={{ left: -16 }}>▶</div>
        {collapsed ? null : (
          <div className="monitor-inner" style={{ width }}>
            <div className="monitor-header">
              <h3>Monitor</h3>
              <span className="monitor-summary">{completedAgents}/{totalAgents}</span>
            </div>
            <div className="monitor-progress"><div className="monitor-progress-fill" style={{ width: pct + '%' }} /></div>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
              {['agents', 'files'].map(t => (
                <button key={t} onClick={() => setTab(t)}
                  style={{ flex: 1, padding: '8px', border: 'none', background: tab === t ? 'var(--surface)' : 'none', color: tab === t ? 'var(--text)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 500, borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.15s' }}>
                  {t === 'agents' ? 'Agents' : 'Files'}
                </button>
              ))}
            </div>
            {tab === 'agents' ? (
              <div className="monitor-agents" style={{ position: 'relative', overflow: 'hidden' }}>
                {conv?.dag && <DAGView data={conv.dag} />}
                {agents.length === 0 && !conv?.dag && <div className="empty-conv" style={{ padding: 16 }}>Waiting for task...</div>}
                {agents.map((a, i) => (
                  <div key={a.name + i}>
                    <div className={'monitor-agent-card ' + a.state} onClick={() => setDetailAgent({ ...a, name: a.name || 'Agent-' + i })}>
                      <div className="monitor-agent-icon" style={a.state === 'completed' ? { background: 'var(--green)', borderColor: 'var(--green)', color: '#fff' } : a.state === 'failed' ? { background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' } : a.state === 'running' ? { borderColor: 'var(--accent)', color: 'var(--accent)', animation: 'pulse-dot 1.2s infinite' } : {}}>
                        {a.state === 'completed' ? '✓' : a.state === 'failed' ? '✗' : '·'}
                      </div>
                      <div className="monitor-agent-info" style={{ flex: 1 }}>
                        <div className="monitor-agent-name">{a.name || 'Agent'}</div>
                        <div className="monitor-agent-action">{a.state + (a.retry ? ' · ' + a.retry + ' retries' : '')}</div>
                      </div>
                      <button className="activity-expand-btn" onClick={e => { e.stopPropagation(); setExpandedActivity(expandedActivity === a.name ? null : a.name) }}>Log</button>
                    </div>
                    {expandedActivity === a.name && (conv?.activity || []).filter(act => act.agent === a.name).map((act, j) => (
                      <div key={j} style={{ padding: '2px 8px 2px 36px', fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                        {({ search_engine: '🔍', webfetch: '🌐', python_executor: '🐍', file_writer: '📝', shell: '💻' })[act.tool] || '🔧'} {act.tool} {act.args?.slice(0, 40)}
                      </div>
                    ))}
                  </div>
                ))}
                {/* Detail slide-out */}
                {detailAgent && (
                  <div className="monitor-detail open">
                    <div className="monitor-detail-header">
                      <button className="monitor-back-btn" onClick={() => setDetailAgent(null)}>← Back</button>
                      <h3>{detailAgent.name}</h3>
                      <span style={{ fontSize: '0.7rem', color: detailAgent.state === 'completed' ? 'var(--green)' : detailAgent.state === 'failed' ? 'var(--red)' : 'var(--accent)' }}>{detailAgent.state + (detailAgent.retry ? ' · ' + detailAgent.retry + ' retries' : '')}</span>
                    </div>
                    <div className="monitor-detail-content">
                      {/* Activity log for this agent */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Activity</div>
                        {(conv?.activity || []).filter(act => act.agent === detailAgent.name).length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>No activity recorded</div>}
                        {(conv?.activity || []).filter(act => act.agent === detailAgent.name).map((act, j) => (
                          <div key={j} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: '0.7rem' }}>
                            <span style={{ color: 'var(--accent)', marginRight: 4 }}>{({ search_engine: '🔍', webfetch: '🌐', python_executor: '🐍', file_writer: '📝', shell: '💻', browser: '🖥' })[act.tool] || '🔧'}</span>
                            <span style={{ fontWeight: 500 }}>{act.tool}</span>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: 2, wordBreak: 'break-all' }}>{act.args}</div>
                          </div>
                        ))}
                      </div>
                      {/* Output */}
                      {detailAgent.output && (
                        <div>
                          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Output</div>
                          <div dangerouslySetInnerHTML={{ __html: mdRender(detailAgent.output) }} />
                        </div>
                      )}
                      {detailAgent.error && (
                        <div style={{ marginTop: 8, color: 'var(--red)', fontSize: '0.7rem' }}>[ERROR] {detailAgent.error}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="monitor-agents">
                {files.length === 0 && <div className="empty-conv" style={{ padding: 16 }}>No files yet</div>}
                {files.map(f => (
                  <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.7rem', color: 'var(--text-secondary)', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-row)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    onClick={() => f.type === 'file' ? openFile(f.path) : null}>
                    <span>{f.type === 'dir' ? '📁' : '📄'}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    {f.type === 'file' && <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{formatSize(f.size)}</span>}
                    {f.type === 'file' && <button onClick={e => { e.stopPropagation(); downloadFile(f.path) }} style={{ padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.6rem' }}>⬇</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {/* File viewer modal */}
      {viewFile && (
        <div className="modal open" onClick={() => setViewFile(null)}>
          <div className="modal-content" style={{ maxWidth: '48rem', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viewFile.path}</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => downloadFile(viewFile.path)} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.75rem' }}>⬇ Download</button>
                <button className="modal-close" onClick={() => setViewFile(null)}>✕</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 16, background: 'var(--bg-deeper)', borderRadius: 8, fontSize: '0.75rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
              {viewFile.binary ? viewFile.content : (viewFile.content || '(empty)')}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function DAGView({ data }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    const render = () => {
      try {
        let mm = 'graph LR\n'
        const colors = ['#6c5ce7', '#00d26a', '#f5a623', '#f93a3a']
        data.parallel_groups?.forEach((g, gi) => {
          mm += `  subgraph G${gi + 1}[Group ${gi + 1}]\n    style G${gi + 1} fill:#1a1a1a,stroke:${colors[gi % 4]}\n`
          g.forEach(tid => { const s = data.subtasks?.find(x => x.id === tid) || {}; mm += `    ${tid}["${(s.name || tid).replace(/[\[\]{}()"'`#&;:<>\\]/g, '').replace(/_/g, ' ').slice(0, 18).trim() || 'Agent'}"]\n` })
          mm += '  end\n'
        })
        data.subtasks?.forEach(s => s.depends_on?.forEach(d => mm += `  ${d} --> ${s.id}\n`))
        if (window.mermaid) window.mermaid.render('dag-monitor-' + Date.now(), mm).then(r => setSvg(r.svg))
      } catch (e) { }
    }
    if (!window.mermaid) {
      const s = document.createElement('script'); s.src = '/static/mermaid.min.js'
      s.onload = () => { window.mermaid?.initialize({ startOnLoad: true, theme: 'dark' }); render() }
      document.head.appendChild(s)
    } else render()
  }, [data])
  return svg ? <div className="dag-container" dangerouslySetInnerHTML={{ __html: svg }} /> : null
}

function formatSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function mdRender(text) {
  if (!text) return ''
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<div class="md-codeblock">$2</div>')
    .replace(/\*\*(.+?)\*\*/g, '<span class="md-bold">$1</span>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\n/g, '<br>')
}
