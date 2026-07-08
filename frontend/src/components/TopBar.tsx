import { useApp } from '@/context/AppContext';
import { useUI } from '@/context/UIContext';

export default function TopBar() {
  const { state: app } = useApp();
  const { state: ui, dispatch: uiDispatch } = useUI();

  const active = app.activeConvId ? app.conversations[app.activeConvId] : null;
  const title = active ? active.title : 'AgentSwarm';

  return (
    <div className="px-6 border-b border-border flex items-center justify-between h-[52px] shrink-0">
      <div className="flex items-center gap-3">
        <button className="btn-ghost w-[34px] h-[34px] text-base" onClick={() => uiDispatch({ type: 'TOGGLE_SIDEBAR' })}>
          ☰
        </button>
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <div className="flex items-center gap-0.5">
        <button className="btn-ghost w-[34px] h-[34px] text-base" onClick={() => uiDispatch({ type: 'TOGGLE_THEME' })}>
          {ui.theme === 'dark' ? '☀' : '☾'}
        </button>
        <button className="btn-ghost w-[34px] h-[34px] text-xs font-semibold" onClick={() => uiDispatch({ type: 'TOGGLE_LANG' })}>
          {ui.lang === 'zh' ? 'EN' : '中'}
        </button>
        <button className="btn-ghost w-[34px] h-[34px] text-base" onClick={() => uiDispatch({ type: 'SET_SETTINGS_OPEN', payload: true })}>
          ⚙
        </button>
      </div>
    </div>
  );
}
