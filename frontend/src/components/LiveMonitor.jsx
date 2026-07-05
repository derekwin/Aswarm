import { useApp } from '../App'

export default function LiveMonitor() {
  const { state } = useApp()
  const agents = Object.values(state.agentStates)
  const done = agents.filter(a => a.state === 'completed' || a.state === 'failed').length
  const pct = state.totalAgents ? Math.round(done / state.totalAgents * 100) : 0

  return (
    <div className="live-monitor open" style={{ width: 320, borderLeft: '1px solid var(--border)' }}>
      <div className="monitor-inner" style={{ width: 320 }}>
        <div className="monitor-header">
          <h3>Live Monitor</h3>
          <span className="monitor-summary">{done}/{state.totalAgents}</span>
        </div>
        <div className="monitor-progress"><div className="monitor-progress-fill" style={{ width: pct + '%' }} /></div>
        <div className="monitor-agents">
          {agents.map(a => (
            <div key={a.name} className={'monitor-agent-card ' + a.state}>
              <div className="monitor-agent-icon">{a.state === 'completed' ? '✓' : a.state === 'failed' ? '✗' : '·'}</div>
              <div className="monitor-agent-info">
                <div className="monitor-agent-name">{a.name}</div>
                <div className="monitor-agent-action">{a.state}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
