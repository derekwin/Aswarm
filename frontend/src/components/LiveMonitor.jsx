import { useApp } from '../App'
import { useState, useEffect, useCallback } from 'react'
import DAGView from './DAGView'
export default function LiveMonitor() {
  const { state, dispatch, setMonitorWidth, t } = useApp()
  const [tab, setTab] = useState('agents')
  const [files, setFiles] = useState([])
  const [viewFile, setViewFile] = useState(null)
  const [detailAgent, setDetailAgent] = useState(null)

  const convId = state.activeConvId
  const conv = convId ? state.conversations[convId] : null
  const agents = Object.values(conv?.agents || {})
  const sortedAgents = [...agents].sort((a, b) => {
    const order = { running: 0, pending: 1, completed: 2, failed: 3 }
    return (order[a.state] || 4) - (order[b.state] || 4)
  })
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

  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX, startW = width
    const onMove = (ev) => { setMonitorWidth(startW + startX - ev.clientX) }
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width, setMonitorWidth])

  const toggleCollapse = () => dispatch({ type: 'SET_MONITOR', payload: collapsed })
  const openFile = (path) => {
    fetch('/api/workspace/' + convId + '/file?path=' + encodeURIComponent(path))
      .then(r => r.json()).then(d => setViewFile(d)).catch(() => {})
  }

  return (
    <>
      <div className={'monitor-collapse-line' + (collapsed ? ' show' : '')} onClick={toggleCollapse} title={t('openMonitor')} />
      <div className={'live-monitor' + (collapsed ? ' collapsed' : '')} style={{ width: collapsed ? 6 : width }}>
        {!collapsed && <div className="monitor-resize-handle" onMouseDown={onMouseDown} />}
        <div className="monitor-toggle-collapse" onClick={toggleCollapse} style={{ left: -16 }}>▶</div>
        {!collapsed && (
          <div className="monitor-inner" style={{ width }}>
            <div className="monitor-header">
              <h3>{t('monitor')}</h3>
              <span className="monitor-summary">{conv?.running && totalAgents > 0 ? completedAgents + '/' + totalAgents : ''}</span>
            </div>
            <div className={'monitor-progress' + (totalAgents > 0 ? ' active' : '')}>
              <div className="monitor-progress-fill" style={{ width: pct + '%' }} />
            </div>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
              {['agents', 'files'].map(tn => (
                <button key={tn} onClick={() => setTab(tn)}
                  style={{ flex: 1, padding: '8px', border: 'none', background: tab === tn ? 'var(--surface)' : 'none', color: tab === tn ? 'var(--text)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 500, borderBottom: tab === tn ? '2px solid var(--accent)' : '2px solid transparent' }}>
                  {tn === 'agents' ? t('agents') : t('files')}
                </button>
              ))}
            </div>
            {tab === 'agents' ? (
              <div className="monitor-agents" style={{ position: 'relative', overflow: 'hidden' }}>
                {sortedAgents.length === 0 && !conv?.dag && <div className="empty-conv" style={{ padding: 16 }}>{t('waiting')}</div>}
                {conv?.dag && <DAGView data={conv.dag} />}
                {sortedAgents.map((a, i) => (
                  <div key={(a.name || 'a') + i} className={'monitor-agent-card ' + (a.state || '')} onClick={() => setDetailAgent(a)}>
                    {a.state === 'running' && <div style={{ position: 'absolute', top: -1, left: -1, right: -1, height: 2, background: 'var(--accent)', borderRadius: '2px 2px 0 0' }} />}
                    <div className="monitor-agent-icon" style={a.state === 'completed' ? { background: 'var(--green)', borderColor: 'var(--green)', color: '#fff' } : a.state === 'failed' ? { background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' } : a.state === 'running' ? { borderColor: 'var(--accent)', color: 'var(--accent)', animation: 'pulse-dot 1.2s infinite' } : {}}>
                      {a.state === 'completed' ? '✓' : a.state === 'failed' ? '✗' : '·'}
                    </div>
                    <div className="monitor-agent-info" style={{ flex: 1 }}>
                      <div className="monitor-agent-name">{a.name || 'Agent'}</div>
                      <div className="monitor-agent-action">{a.state || ''}</div>
                    </div>
                  </div>
                ))}
                {detailAgent && (
                  <div className="monitor-detail open">
                    <div className="monitor-detail-header">
                      <button className="monitor-back-btn" onClick={() => setDetailAgent(null)}>← {t('back')}</button>
                      <h3>{detailAgent.name || 'Agent'}</h3>
                    </div>
                    <div className="monitor-detail-content">
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('activity')}</div>
                        {(conv?.activity || []).filter(act => act.agent === detailAgent.name).length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{t('noActivity')}</div>}
                        {(conv?.activity || []).filter(act => act.agent === detailAgent.name).map((act, j) => (
                          <div key={j} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: '0.7rem' }}>
                            <span style={{ fontWeight: 500 }}>{act.tool}</span>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: 2, wordBreak: 'break-all' }}>{act.args}</div>
                          </div>
                        ))}
                      </div>
                      {detailAgent.output && <div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('output')}</div>
                        <div dangerouslySetInnerHTML={{ __html: mdRender(detailAgent.output) }} />
                      </div>}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="monitor-agents">
                {files.length === 0 && <div className="empty-conv" style={{ padding: 16 }}>{t('noFiles')}</div>}
                {files.map(f => (
                  <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, cursor: f.type === 'file' ? 'pointer' : 'default', fontSize: '0.7rem', color: 'var(--text-secondary)' }}
                    onClick={() => f.type === 'file' ? openFile(f.path) : null}>
                    <span>{f.type === 'dir' ? '📁' : '📄'}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    {f.type === 'file' && <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{formatSize(f.size)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

function DAGView({ data }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    if (!data) return
    const render = () => {
      try {
        let mm = 'graph LR\n'
        const colors = ['#6c5ce7', '#00d26a', '#f5a623', '#f93a3a'];
        (data.parallel_groups || []).forEach((g, gi) => {
          mm += `  subgraph G${gi + 1}[Group ${gi + 1}]\n    style G${gi + 1} fill:#1e1e24,stroke:${colors[gi % 4]}\n`;
          (g || []).forEach(tid => {
            const s = (data.subtasks || []).find(x => x.id === tid) || {}
            const name = String(s.name || tid).slice(0, 18).replace(/[^a-zA-Z0-9 _-]/g, '') || 'Agent'
            mm += `    ${tid}["${name}"]\n`
          })
          mm += '  end\n'
        });
        (data.subtasks || []).forEach(s => (s.depends_on || []).forEach(d => mm += `  ${d} --> ${s.id}\n`))
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
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<div class="md-codeblock">$2</div>')
    .replace(/\*\*(.+?)\*\*/g, '<span class="md-bold">$1</span>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\n/g, '<br>')
}
