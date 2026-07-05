import { useApp } from '../App'

export default function LiveMonitor() {
  const { state, dispatch } = useApp()
  const agents = Object.values(state.agentStates)
  const done = agents.filter(a => a.state === 'completed' || a.state === 'failed').length
  const pct = state.totalAgents ? Math.round(done / state.totalAgents * 100) : 0

  return (
    <div className="live-monitor open" style={{ width: 320, borderLeft: '1px solid var(--border)', position: 'relative' }}>
      <div className="monitor-toggle" style={{ position: 'absolute', right: '100%', top: '50%' }} onClick={() => dispatch({ type: 'SET_MONITOR', payload: false })}>
        <span>▶</span>
      </div>
      <div className="monitor-inner" style={{ width: 320 }}>
        <div className="monitor-header">
          <h3>Live Monitor</h3>
          <span className="monitor-summary">{done}/{state.totalAgents}</span>
        </div>
        <div className="monitor-progress"><div className="monitor-progress-fill" style={{ width: pct + '%' }} /></div>
        <div className="monitor-agents">
          {agents.length === 0 && <div className="empty-conv" style={{ padding: 16 }}>No agents running</div>}
          {agents.map((a, i) => (
            <div key={a.name + i} className={'monitor-agent-card ' + a.state}>
              <div className={'monitor-agent-icon'} style={a.state==='completed'?{background:'var(--green)',borderColor:'var(--green)',color:'#fff'}:a.state==='failed'?{background:'var(--red)',borderColor:'var(--red)',color:'#fff'}:a.state==='running'?{borderColor:'var(--accent)',color:'var(--accent)'}:{}}>
                {a.state === 'completed' ? '✓' : a.state === 'failed' ? '✗' : '·'}
              </div>
              <div className="monitor-agent-info">
                <div className="monitor-agent-name">{a.name || 'Agent'}</div>
                <div className="monitor-agent-action">{a.state + (a.retry ? ' · ' + a.retry + ' retries' : '')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
