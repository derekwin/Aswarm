import type { AgentState } from '@/types';
import { useUI } from '@/context/UIContext';

interface Props {
  agents: Record<string, AgentState>;
  totalAgents: number;
  completedAgents: number;
}

export default function AgentCardList({ agents, totalAgents, completedAgents }: Props) {
  const { dispatch: uiDispatch } = useUI();

  const sorted = Object.entries(agents).sort(([, a], [, b]) => {
    const order: Record<string, number> = { running: 0, pending: 1, completed: 2, failed: 3 };
    return (order[a.state] || 4) - (order[b.state] || 4);
  });

  const pct = totalAgents ? Math.round(completedAgents / totalAgents * 100) : 0;

  if (sorted.length === 0 && totalAgents === 0) return null;

  return (
    <div className="flex items-center gap-2 shrink-0">
    <div className="flex items-center gap-2 shrink-0" style={{ paddingBottom: 0 }}>
        <div className="w-20 h-[3px] bg-bg-surface rounded-sm overflow-hidden">
          <div className="h-full bg-accent rounded-sm transition-all duration-300" style={{ width: pct + '%' }} />
        </div>
        <span className="text-xs text-text-secondary font-semibold font-mono min-w-[32px]">{completedAgents}/{totalAgents}</span>
      </div>
      <div className="flex flex-wrap gap-1 flex-1 overflow-hidden">
        {sorted.map(([id, a]) => {
          const stateCls = a.state === 'running' ? 'border-accent bg-accent-soft' : a.state === 'completed' ? 'border-success/30 bg-success-soft' : a.state === 'failed' ? 'border-danger/30 bg-danger-soft' : '';
          const dotCls = a.state === 'running' ? 'border-accent text-accent bg-accent-soft animate-pulse-dot' : a.state === 'completed' ? 'bg-success border-success text-white' : a.state === 'failed' ? 'bg-danger border-danger text-white' : 'border-border text-text-muted';
          const dotIcon = a.state === 'completed' ? '✓' : a.state === 'failed' ? '✗' : '·';
          return (
            <button
              key={id}
              className={`flex items-center gap-1.5 px-2.5 py-1 bg-bg-surface border border-transparent rounded-2xl text-[11px] whitespace-nowrap hover:border-accent hover:bg-accent-soft transition-all ${stateCls}`}
              onClick={(e) => { e.stopPropagation(); uiDispatch({ type: 'SET_PANEL_AGENT', payload: a }); }}
            >
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold border-[1.5px] shrink-0 ${dotCls}`}>
                {dotIcon}
              </span>
              <span className="text-text-primary font-medium">{a.name}</span>
              {a.role && (
                <span className="text-text-muted text-[10px]">({a.role})</span>
              )}
              {a.retryCount > 0 && (
                <span className="text-[10px] text-warning">↻{a.retryCount}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
