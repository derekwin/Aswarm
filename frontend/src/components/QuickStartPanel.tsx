import { useApp } from '@/context/AppContext';
import { useT } from '@/hooks/useT';
import { api } from '@/api';

type I18nKey = 'quickResearch' | 'quickCode' | 'quickCompare' | 'quickResearchQuery' | 'quickCodeQuery' | 'quickCompareQuery';

const QUICK_STARTS: { icon: string; titleKey: I18nKey; queryKey: I18nKey }[] = [
  { icon: '🔬', titleKey: 'quickResearch', queryKey: 'quickResearchQuery' },
  { icon: '💻', titleKey: 'quickCode', queryKey: 'quickCodeQuery' },
  { icon: '📊', titleKey: 'quickCompare', queryKey: 'quickCompareQuery' },
];

export default function QuickStartPanel() {
  const { dispatch: appDispatch } = useApp();
  const t = useT();

  const handleQuickStart = async (title: string, query: string) => {
    try {
      const c = await api.createConversation(title);
      appDispatch({ type: 'ADD_CONV', payload: { id: c.id, title: c.title, created_at: c.created_at } });
      setTimeout(() => {
        const el = document.getElementById('queryInput') as HTMLTextAreaElement | null;
        if (el) { el.value = query; el.focus(); }
      }, 100);
    } catch { /* ignore */ }
  };

  const handleNewTask = async () => {
    try {
      const c = await api.createConversation();
      appDispatch({ type: 'ADD_CONV', payload: { id: c.id, title: c.title, created_at: c.created_at } });
      setTimeout(() => document.getElementById('queryInput')?.focus(), 100);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-text-secondary px-6">
      <div className="w-20 h-20 flex items-center justify-center text-4xl bg-bg-surface border border-border rounded-xl mb-1">⚡</div>
      <h1 className="text-2xl font-bold text-text-primary">AgentSwarm</h1>
      <p className="text-text-muted text-base">Describe your task to see the agent orchestration plan</p>
      <div className="flex flex-wrap gap-3 justify-center max-w-2xl mt-2">
        {QUICK_STARTS.map(({ icon, titleKey, queryKey }) => (
          <button key={titleKey} className="flex flex-col items-center gap-2 p-4 bg-bg-surface border border-border rounded-xl w-56 hover:border-accent hover:bg-accent-soft hover:scale-[1.02] transition-all text-left group shadow-sm hover:shadow-md"
            onClick={() => handleQuickStart(t(titleKey), t(queryKey))}>
            <span className="text-2xl">{icon}</span>
            <span className="text-sm font-semibold text-text-primary group-hover:text-accent">{t(titleKey)}</span>
            <span className="text-xs text-text-muted line-clamp-2">{t(queryKey).slice(0, 60)}...</span>
          </button>
        ))}
      </div>
      <button className="btn-primary btn-lg mt-2" onClick={handleNewTask}>
        {t('newTask')}
      </button>
    </div>
  );
}
