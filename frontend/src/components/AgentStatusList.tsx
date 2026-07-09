import { useConv } from '@/context/ConvContext';
import { useUI } from '@/context/UIContext';
import { useT } from '@/hooks/useT';

function SkeletonRow() {
  return (
    <div className="flex items-center gap-2 w-full py-1.5 px-2 animate-shimmer">
      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-bg-surface" />
      <span className="h-3 rounded bg-bg-surface flex-1" />
      <span className="h-3 w-12 rounded bg-bg-surface shrink-0" />
    </div>
  );
}

export default function AgentStatusList() {
  const { state: conv } = useConv();
  const { state: ui, dispatch: uiDispatch } = useUI();
  const t = useT();

  const agents = Object.values(conv.agents);
  const hasValidAgents = agents.some(a => a.name && a.name !== '');
  const isDecomposing = conv.execState === 'decomposing';

  if (isDecomposing && !hasValidAgents) {
    return (
      <div className="mt-2 border-t border-border-subtle pt-2 animate-fade-up">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-[11px] font-semibold text-accent flex-1">{t('decomposing')}</span>
          <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
        <div className="rounded-lg border border-border-subtle bg-bg-base/50 overflow-hidden">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </div>
    );
  }

  if (agents.length === 0 || !hasValidAgents) return null;

  const completed = agents.filter(a => a.state === 'completed' || a.state === 'failed').length;
  const total = agents.length;
  const anyRunning = agents.some(a => a.state === 'running');
  const allDone = completed === total && !anyRunning;

  const groups: string[][] = conv.dag?.parallel_groups?.length
    ? conv.dag.parallel_groups
    : [agents.map(a => a.subtaskId || '').filter(Boolean)];

  let anyGroupPopulated = false;
  const groupElements = groups.map((group, gi) => {
    const groupAgents = group.map(id => conv.agents[id]).filter(Boolean);
    if (groupAgents.length === 0) return null;
    anyGroupPopulated = true;
    return (
      <div key={gi} className="mb-1.5 rounded-lg border border-border-subtle bg-bg-base/50 overflow-hidden">
        {groups.length > 1 && (
          <div className="text-[9px] text-text-muted px-2 py-0.5 border-b border-border-subtle bg-bg-base/30 font-medium uppercase">
            Phase {gi + 1}
          </div>
        )}
        <div className={`${groupAgents.length > 1 ? 'divide-y divide-border-subtle' : ''}`}>
          {groupAgents.map((agent) => (
            <button
              key={agent.subtaskId || agent.name}
              className="flex items-center gap-2 w-full text-left py-1.5 px-2 text-xs hover:bg-white/4 transition-colors"
              onClick={() => uiDispatch({ type: 'SET_PANEL_AGENT', payload: agent })}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${agent.state === 'running' ? 'bg-accent animate-pulse' : agent.state === 'completed' ? 'bg-success' : agent.state === 'failed' ? 'bg-danger' : 'bg-text-muted'}`} />
              <span className="truncate text-text-primary min-w-0">{agent.name}</span>
              {agent.role && (
                <span className="text-text-muted text-[10px] px-1 py-0.5 rounded bg-bg-base shrink-0">{agent.role}</span>
              )}
              <span className={`text-[10px] shrink-0 ${agent.state === 'running' ? 'text-accent' : agent.state === 'completed' ? 'text-success' : agent.state === 'failed' ? 'text-danger' : 'text-text-muted'}`}>
                {t(agent.state === 'running' ? 'running' : agent.state === 'completed' ? 'completed' : agent.state === 'failed' ? 'failed' : 'pending')}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  });

  const renderGroups = anyGroupPopulated ? groupElements : (
    <div className="mb-1.5 rounded-lg border border-border-subtle bg-bg-base/50 overflow-hidden">
      <div className={`${agents.length > 1 ? 'divide-y divide-border-subtle' : ''}`}>
        {agents.map((agent) => (
          <button
            key={agent.subtaskId || agent.name}
            className="flex items-center gap-2 w-full text-left py-1.5 px-2 text-xs hover:bg-white/4 transition-colors"
            onClick={() => uiDispatch({ type: 'SET_PANEL_AGENT', payload: agent })}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${agent.state === 'running' ? 'bg-accent animate-pulse' : agent.state === 'completed' ? 'bg-success' : agent.state === 'failed' ? 'bg-danger' : 'bg-text-muted'}`} />
            <span className="truncate text-text-primary min-w-0">{agent.name}</span>
            {agent.role && (
              <span className="text-text-muted text-[10px] px-1 py-0.5 rounded bg-bg-base shrink-0">{agent.role}</span>
            )}
            <span className={`text-[10px] shrink-0 ${agent.state === 'running' ? 'text-accent' : agent.state === 'completed' ? 'text-success' : agent.state === 'failed' ? 'text-danger' : 'text-text-muted'}`}>
              {t(agent.state === 'running' ? 'running' : agent.state === 'completed' ? 'completed' : agent.state === 'failed' ? 'failed' : 'pending')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mt-2 border-t border-border-subtle pt-2 animate-fade-up">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full ${anyRunning ? 'bg-accent animate-pulse' : allDone ? 'bg-success' : 'bg-text-muted'}`} />
        <span className="text-[11px] font-semibold text-text-secondary flex-1">
          {t(anyRunning ? 'running' : allDone ? 'complete' : 'waiting')}
          {' · '}{completed}/{total}
        </span>
        <button className="btn-ghost w-6 h-6 text-xs" title="Files" onClick={() => {
          if (ui.panelMode === 'files') uiDispatch({ type: 'CLOSE_PANEL' });
          else uiDispatch({ type: 'OPEN_PANEL', payload: 'files' });
        }}>📂</button>
      </div>
      {renderGroups}
    </div>
  );
}
