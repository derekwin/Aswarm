import { useState, useEffect, lazy, Suspense } from 'react';
import { useUI } from '@/context/UIContext';
import { useConv } from '@/context/ConvContext';
import { useT } from '@/hooks/useT';

const Markdown = lazy(() => import('@/components/Markdown'));

interface TraceData {
  prompt?: string;
  trace_events?: { event_type: string; agent_name: string; data: Record<string, unknown>; timestamp: number }[];
}

async function loadTraceData(taskId: string, subtaskId: string): Promise<TraceData> {
  const resp = await fetch(`/api/trace/${taskId}/${subtaskId}`);
  return resp.ok ? resp.json() : {};
}

export default function AgentDetailPanel() {
  const { state: ui, dispatch: uiDispatch } = useUI();
  const { state: conv } = useConv();
  const t = useT();
  const [trace, setTrace] = useState<TraceData | null>(null);

  const agent = ui.panelAgent;
  const agentActivity = conv.activity.filter(a => agent && a.agent === agent.name);

  useEffect(() => {
    if (!conv.taskId || !agent?.subtaskId) return;
    let cancelled = false;
    loadTraceData(conv.taskId, agent.subtaskId).then(d => {
      if (!cancelled) setTrace(d);
    });
    return () => { cancelled = true; };
  }, [agent?.subtaskId, conv.taskId]);

  if (!agent) return <div className="bg-bg-surface flex flex-col h-full" />;

  return (
    <div className="bg-bg-surface flex flex-col h-full">
      <div className="px-4 border-b border-border flex items-center justify-between h-[52px]">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-base font-semibold truncate">{agent.name || 'Agent'}</h3>
          {agent.role && <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg-base shrink-0">{agent.role}</span>}
        </div>
        <button className="btn-ghost w-7 h-7" onClick={() => uiDispatch({ type: 'CLOSE_PANEL' })}>✕</button>
      </div>

      <div className="px-4 py-2.5 flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${agent.state === 'running' ? 'bg-accent animate-pulse' : agent.state === 'completed' ? 'bg-success' : agent.state === 'failed' ? 'bg-danger' : 'bg-text-muted'}`} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${agent.state === 'running' ? 'text-accent' : agent.state === 'completed' ? 'text-success' : agent.state === 'failed' ? 'text-danger' : 'text-text-muted'}`}>
          {agent.state}{agent.retryCount > 0 ? ` · retries: ${agent.retryCount}` : ''}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Trace: prompt + timeline */}
        <div>
          <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide mb-2">{t('trace')}</div>

          {trace?.prompt && (
            <div className="p-3 bg-bg-base border border-border-subtle rounded-md text-xs text-text-secondary whitespace-pre-wrap font-mono mb-3">
              {trace.prompt}
            </div>
          )}

          {agentActivity.length > 0 ? (
            <div className="space-y-1">
              {agentActivity.map((act, i) => (
                <div key={i} className="py-1.5 px-2 rounded bg-bg-base text-xs flex gap-2">
                  <span className="text-accent font-mono shrink-0">{act.tool}</span>
                  <span className="text-text-muted truncate">{act.args.slice(0, 100)}</span>
                </div>
              ))}
            </div>
          ) : trace?.trace_events && trace.trace_events.length > 0 ? (
            <div className="space-y-1">
              {trace.trace_events.map((evt, i) => (
                <div key={i} className="py-1.5 px-2 rounded bg-bg-base text-xs flex gap-2">
                  <span className="text-accent font-mono shrink-0">{evt.event_type}</span>
                  {evt.data && <span className="text-text-muted truncate">{JSON.stringify(evt.data).slice(0, 100)}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted italic">{t('noTraceData')}</p>
          )}
        </div>

        {/* Output: agent result */}
        <div>
          <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide mb-2">{t('output')}</div>
          {agent.output ? (
            <Suspense fallback={<div className="animate-shimmer h-4 rounded bg-bg-surface w-3/4" />}>
              <Markdown content={agent.output} />
            </Suspense>
          ) : (
            <div className="text-xs text-text-muted italic">{t('waiting')}</div>
          )}
          {agent.error && (
            <div className="mt-2 p-3 bg-danger-soft rounded-md text-xs text-danger">{agent.error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
