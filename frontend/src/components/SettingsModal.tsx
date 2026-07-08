import { useState, useMemo } from 'react';
import { useUI } from '@/context/UIContext';
import { useApp } from '@/context/AppContext';
import { useT } from '@/hooks/useT';
import { api } from '@/api';
import type { Settings } from '@/types';

export default function SettingsModal() {
  const { state: ui, dispatch: uiDispatch } = useUI();
  const { state: app, dispatch: appDispatch } = useApp();
  const t = useT();
  const [provider, setProvider] = useState('ollama');
  const [saved, setSaved] = useState(false);

  const defaultSettings: Settings = useMemo(() => ({
    llm_base_url: app.settings?.llm_base_url || '',
    llm_api_key: app.settings?.llm_api_key || '',
    decomposer_model: app.settings?.decomposer_model || '',
    default_model: app.settings?.default_model || '',
  }), [app.settings]);

  const [cfg, setCfg] = useState<Settings>(defaultSettings);

  const applyProvider = (p: string) => {
    setProvider(p);
    const defaults: Record<string, Partial<Settings>> = {
      ollama: { llm_base_url: 'http://localhost:11434/v1', llm_api_key: 'ollama' },
      openai: { llm_base_url: 'https://api.openai.com/v1', llm_api_key: '' },
      anthropic: { llm_base_url: 'https://api.anthropic.com/v1', llm_api_key: '' },
    };
    const d = defaults[p] || {};
    setCfg(prev => ({ ...prev, ...d }));
  };

  const save = async () => {
    try {
      const savedSettings = await api.saveSettings(cfg);
      appDispatch({ type: 'SET_SETTINGS', payload: savedSettings });
      setSaved(true);
      setTimeout(() => { setSaved(false); uiDispatch({ type: 'SET_SETTINGS_OPEN', payload: false }); }, 600);
    } catch {
      uiDispatch({ type: 'ADD_TOAST', payload: t('saveSettingsFailed') });
    }
  };

  if (!ui.settingsOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={e => { if (e.target === e.currentTarget) uiDispatch({ type: 'SET_SETTINGS_OPEN', payload: false }); }}>
      <div className="w-[440px] max-h-[80vh] bg-bg-elevated border border-border-subtle rounded-xl flex flex-col overflow-hidden shadow-2xl">
        <div className="px-4 border-b border-border-subtle flex items-center justify-between h-[52px]">
          <h2 className="text-lg font-semibold">{t('settings')}</h2>
          <button className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-white/4 hover:text-text-primary transition-all" onClick={() => uiDispatch({ type: 'SET_SETTINGS_OPEN', payload: false })}>✕</button>
        </div>
        <div className="flex gap-1 border-b border-border-subtle px-2 pt-2">
          {['ollama', 'openai', 'anthropic'].map(p => (
            <button key={p} className={`btn-ghost btn-sm !rounded-b-none border-b-2 ${provider === p ? 'text-accent border-accent' : 'text-text-secondary border-transparent hover:text-text-primary'}`} onClick={() => applyProvider(p)}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <div className="p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">{t('baseUrl')}</label>
            <input value={cfg.llm_base_url} onChange={e => setCfg({ ...cfg, llm_base_url: e.target.value })} className="input-base" />
          </div>
          {provider !== 'ollama' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary">{t('apiKey')}</label>
              <input value={cfg.llm_api_key} onChange={e => setCfg({ ...cfg, llm_api_key: e.target.value })} className="input-base" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">{t('decomposerModel')}</label>
            <input value={cfg.decomposer_model} onChange={e => setCfg({ ...cfg, decomposer_model: e.target.value })} className="input-base" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">{t('defaultModel')}</label>
            <input value={cfg.default_model} onChange={e => setCfg({ ...cfg, default_model: e.target.value })} className="input-base" />
          </div>
        </div>
        <button className={`btn-primary btn-md m-4 transition-all ${saved ? '!bg-success scale-105' : ''}`} onClick={save}>
          {saved ? '✓ ' + t('saved') : t('save')}
        </button>
      </div>
    </div>
  );
}
