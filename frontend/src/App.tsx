import { useEffect, useRef, useLayoutEffect, startTransition } from 'react';
import { AppProvider, useApp } from '@/context/AppContext';
import { UIProvider, useUI } from '@/context/UIContext';
import { ConvProvider, useConv } from '@/context/ConvContext';
import { useTaskRunner } from '@/hooks/useTaskRunner';
import { usePanelWidth } from '@/hooks/usePanelWidth';
import { api } from '@/api';

import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import ResultStream from '@/components/ResultStream';
import InputBar from '@/components/InputBar';
import SettingsModal from '@/components/SettingsModal';
import ToastContainer from '@/components/ToastContainer';
import RightPanel from '@/components/RightPanel';
import Skeleton from '@/components/Skeleton';
import QuickStartPanel from '@/components/QuickStartPanel';

function AppInner() {
  const { state: app } = useApp();
  const { state: conv, dispatch: convDispatch } = useConv();
  const { state: ui, dispatch: uiDispatch } = useUI();
  const { runTask, reconnect, cancelTask, connectSSE, cleanupRefs } = useTaskRunner();
  const { panelWidth, onPanelResize } = usePanelWidth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingConvId = useRef<string | null>(null);
  const execStateRef = useRef(conv.execState);
  useEffect(() => { execStateRef.current = conv.execState; }, [conv.execState]);

  // Auto-open right panel on large screens when agents are present
  useEffect(() => {
    const agentCount = Object.keys(conv.agents).length;
    if (agentCount > 0 && window.innerWidth >= 1024 && !ui.panelMode) {
      uiDispatch({ type: 'OPEN_PANEL', payload: 'agent' });
    }
  }, [conv.agents, uiDispatch, ui.panelMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('queryInput')?.focus();
      }
      if (e.key === 'Escape') {
        uiDispatch({ type: 'CLOSE_PANEL' });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [uiDispatch]);

  // Three-phase recovery: Cache → API diff → SSE reconnect
  useLayoutEffect(() => {
    const activeId = app.activeConvId;
    const execing = execStateRef.current === 'streaming' || execStateRef.current === 'decomposing' || execStateRef.current === 'reconnecting';
    if (execing) {
      // Cancel without API call (silent), fire-and-forget is safe here
      cancelTask(true);
    }
    uiDispatch({ type: 'CLOSE_PANEL' });
    convDispatch({ type: 'RESET' });
    cleanupRefs();
    if (!activeId) return;
    loadingConvId.current = activeId;

    // Phase A: localStorage cache restore
    let lastEventId = 0;
    let snapshotRestored = false;
    try {
      const cached = localStorage.getItem(`conv:${activeId}`);
      if (cached) {
        const entry = JSON.parse(cached);
        if (Date.now() - (entry.ts || 0) < 300000) {
          startTransition(() => {
            convDispatch({ type: 'RESTORE_SNAPSHOT', payload: { ...entry, loading: false, _fromCache: true } });
          });
          snapshotRestored = true;
          lastEventId = entry._lastEventId || 0;
        }
      }
    } catch { /* ignore */ }

    // Phase B: Backend sync
    loadingConvId.current = activeId;
    Promise.all([
      api.getConversation(activeId).catch(() => null),
      api.getRunningTask(activeId).catch(() => null),
    ]).then(([convData, taskData]) => {
      if (loadingConvId.current !== activeId) return;

      if (convData && !snapshotRestored) {
        const msgs = (convData.messages || []).map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant', content: m.content,
        }));
        convDispatch({ type: 'LOAD', payload: { messages: msgs } });
      }

      if (!taskData?.task) { convDispatch({ type: 'SET_LOADING', payload: false }); return; }

      if (taskData.task.dag_data) {
        try {
          const dag = JSON.parse(taskData.task.dag_data);
          convDispatch({ type: 'SET_DAG', payload: { dag, totalAgents: dag.subtasks?.length || 0 } });
        } catch { /* ignore */ }
      }

      if (taskData.agent_results) {
        // Phase 1: Populate all agents from DAG data first (ensures name/role survive recovery)
        if (taskData.task.dag_data) {
          try {
            const dag = JSON.parse(taskData.task.dag_data);
            for (const s of (dag.subtasks || [])) {
              convDispatch({ type: 'UPDATE_AGENT', payload: { id: s.id, data: { name: s.name, role: s.role, state: 'pending', retryCount: 0, subtaskId: s.id } } });
            }
          } catch { /* ignore */ }
        }
        // Phase 2: Overlay actual results on top (preserves name/role from DAG if not in result)
        const completedSet = new Set(taskData.agent_results.filter((r: { state: string }) => r.state === 'completed' || r.state === 'failed').map((r: { subtask_id: string }) => r.subtask_id));
        for (const r of taskData.agent_results) {
          const existing = conv.agents[r.subtask_id];
          convDispatch({ type: 'UPDATE_AGENT', payload: { id: r.subtask_id, data: { name: r.agent_name || existing?.name || '', role: existing?.role || '', state: r.state as 'pending' | 'running' | 'completed' | 'failed', output: r.output, error: r.error, retryCount: r.retry_count, subtaskId: r.subtask_id } } });
          if (completedSet.has(r.subtask_id)) convDispatch({ type: 'INCREMENT_COMPLETED', payload: { subtaskId: r.subtask_id } });
        }
      }

      const completed = taskData.agent_results.filter((r: { state: string }) => r.state === 'completed' || r.state === 'failed').length;
      const total = taskData.task.subtask_count || taskData.agent_results.length || 0;
      if (total > 0) convDispatch({ type: 'SET_PROGRESS', payload: { completed, total } });

      const status = taskData.task.status;
      if (status === 'completed') {
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'completed' });
      } else if (status === 'failed') {
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'failed' });
      } else if (status === 'running') {
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'reconnecting' });
        connectSSE(taskData.task.id, lastEventId);
      }
      convDispatch({ type: 'SET_LOADING', payload: false });
    });
  }, [app.activeConvId, convDispatch, cancelTask, reconnect]);

  const hasConvs = Object.keys(app.conversations).length > 0;

  return (
    <div id="app" className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 bg-bg-base">
        <TopBar />
        {!hasConvs ? <QuickStartPanel /> : conv.loading ? <Skeleton /> : (
          <div className="flex flex-col flex-1 min-h-0" ref={scrollRef}>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ResultStream
                onEditRerun={(query) => { if (app.activeConvId) runTask(app.activeConvId, query); }}
                taskId={conv.taskId || undefined}
              />
            </div>
            {hasConvs && <InputBar onSend={runTask} onStop={cancelTask} />}
          </div>
        )}
      </main>
      <RightPanel panelWidth={panelWidth} onPanelResize={onPanelResize} />
      <SettingsModal />
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <UIProvider>
        <ConvProvider>
          <AppInner />
        </ConvProvider>
      </UIProvider>
    </AppProvider>
  );
}
