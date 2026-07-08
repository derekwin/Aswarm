import { useState, useMemo, useEffect, useReducer } from 'react';
import { useApp } from '@/context/AppContext';
import { useUI } from '@/context/UIContext';
import { useT } from '@/hooks/useT';
import { api } from '@/api';

function isConvRunning(convId: string): boolean {
  try {
    const raw = localStorage.getItem(`conv:${convId}`);
    if (!raw) return false;
    const entry = JSON.parse(raw);
    return entry.execState === 'streaming' || entry.execState === 'reconnecting' || entry.execState === 'decomposing';
  } catch { return false; }
}

export default function Sidebar() {
  const { state, dispatch } = useApp();
  const { state: uiState, dispatch: uiDispatch } = useUI();
  const t = useT();
  const [filter, setFilter] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Periodic tick to re-check localStorage for running status changes
  const [tick, bumpTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(bumpTick, 3000);
    return () => clearInterval(id);
  }, []);
  const runningIds = useMemo(() => {
    const running = new Set<string>();
    for (const id of Object.keys(state.conversations)) {
      if (isConvRunning(id)) running.add(id);
    }
    return running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.conversations, tick]);
  const open = uiState.sidebarOpen;

  const newConv = async () => {
    try {
      const c = await api.createConversation();
      dispatch({ type: 'ADD_CONV', payload: { id: c.id, title: c.title, created_at: c.created_at } });
    } catch {
      uiDispatch({ type: 'ADD_TOAST', payload: t('createConvFailed') });
    }
  };

  const delConv = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    try {
      await api.deleteConversation(deletingId);
      dispatch({ type: 'DEL_CONV', payload: deletingId });
    } catch {
      uiDispatch({ type: 'ADD_TOAST', payload: t('deleteConvFailed') });
    }
    setDeletingId(null);
  };

  const switchConv = (id: string) => {
    if (state.activeConvId === id) return;
    dispatch({ type: 'SET_ACTIVE', payload: id });
    uiDispatch({ type: 'SET_SIDEBAR_OPEN', payload: false });
  };

  const ids = Object.keys(state.conversations).filter(id =>
    state.conversations[id].title.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => uiDispatch({ type: 'SET_SIDEBAR_OPEN', payload: false })}
      />
      <aside className={`w-[264px] min-w-[264px] glass-heavy flex flex-col shrink-0 transition-transform lg:translate-x-0 lg:static fixed top-0 bottom-0 left-0 z-50 ${open ? 'translate-x-0' : '-translate-x-full'} lg:shadow-none shadow-2xl`}>
        <div className="px-4 flex items-center gap-3 border-b border-border-subtle h-[52px]">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-accent to-purple-400 flex items-center justify-center text-xs shrink-0">⚡</div>
          <h2 className="text-base font-bold">AgentSwarm</h2>
        </div>
        <div className="p-3">
          <input
            type="text"
            placeholder={t('search')}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="input-base text-sm"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {ids.length === 0 && <div className="text-center py-8 text-text-muted text-sm">{t('noConvs')}</div>}
          {ids.map(id => {
            const c = state.conversations[id];
            const active = id === state.activeConvId;
            return (
              <div key={id}>
                <div
                  className={`group px-3 py-2.5 rounded-md cursor-pointer text-sm transition-all mb-px flex items-center justify-between border-l-2 ${active ? 'bg-bg-surface text-text-primary font-medium border-accent' : 'text-text-secondary hover:bg-white/4 border-transparent'}`}
                  onClick={() => switchConv(id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate flex items-center gap-1.5">
                      {runningIds.has(id) && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />}
                      {c.title}
                    </div>
                    <div className="text-[11px] text-text-muted">
                      {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <span className={`opacity-0 px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:text-danger hover:bg-danger-soft transition-all ${deletingId === id ? 'opacity-100' : 'group-hover:opacity-100'}`} onClick={e => delConv(id, e)}>✕</span>
                </div>
                {deletingId === id && (
                  <div className="flex gap-2 px-3 pb-2">
                    <button className="text-[11px] text-danger hover:underline" onClick={confirmDelete}>{t('deleteConfirm')}</button>
                    <button className="text-[11px] text-text-muted hover:text-text-primary" onClick={() => setDeletingId(null)}>{t('cancel')}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button className="btn-secondary btn-md mx-4 mb-3 w-[calc(100%-2rem)]" onClick={newConv}>
          + {t('newTask')}
        </button>
      </aside>
    </>
  );
}
