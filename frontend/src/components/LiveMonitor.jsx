import { useApp } from '../App'

export default function LiveMonitor() {
  const { state } = useApp()
  return (
    <div style={{ width: 480, borderLeft: '1px solid var(--border)', background: 'var(--bg-deeper)', padding: 16 }}>
      <h3>Monitor</h3>
      <p>placeholder</p>
    </div>
  )
}
