import { createContext, useContext, useReducer, useEffect, type ReactNode, type Dispatch } from 'react';
import type { Theme, Lang, Toast, AgentState } from '@/types';

interface UIState {
  theme: Theme;
  lang: Lang;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  panelAgent: AgentState | null;
  panelMode: 'agent' | 'files' | null;
  toasts: Toast[];
  connected: boolean;
}

type UIAction =
  | { type: 'SET_THEME'; payload: Theme }
  | { type: 'TOGGLE_THEME' }
  | { type: 'SET_LANG'; payload: Lang }
  | { type: 'TOGGLE_LANG' }
  | { type: 'SET_SIDEBAR_OPEN'; payload: boolean }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SETTINGS_OPEN'; payload: boolean }
  | { type: 'SET_PANEL_AGENT'; payload: AgentState | null }
  | { type: 'OPEN_PANEL'; payload: 'agent' | 'files' }
  | { type: 'CLOSE_PANEL' }
  | { type: 'ADD_TOAST'; payload: string }
  | { type: 'REMOVE_TOAST'; payload: number }
  | { type: 'SET_CONNECTED'; payload: boolean };

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_THEME': return { ...state, theme: action.payload };
    case 'TOGGLE_THEME': return { ...state, theme: state.theme === 'dark' ? 'light' : 'dark' };
    case 'SET_LANG': return { ...state, lang: action.payload };
    case 'TOGGLE_LANG': return { ...state, lang: state.lang === 'zh' ? 'en' : 'zh' };
    case 'SET_SIDEBAR_OPEN': return { ...state, sidebarOpen: action.payload };
    case 'TOGGLE_SIDEBAR': return { ...state, sidebarOpen: !state.sidebarOpen };
    case 'SET_SETTINGS_OPEN': return { ...state, settingsOpen: action.payload };
    case 'SET_PANEL_AGENT': return { ...state, panelAgent: action.payload, panelMode: action.payload ? 'agent' : null };
    case 'OPEN_PANEL': return { ...state, panelMode: action.payload };
    case 'CLOSE_PANEL': return { ...state, panelMode: null, panelAgent: null };
    case 'ADD_TOAST': return { ...state, toasts: [...state.toasts, { id: Date.now(), message: action.payload }] };
    case 'REMOVE_TOAST': return { ...state, toasts: state.toasts.filter(t => t.id !== action.payload) };
    case 'SET_CONNECTED': return { ...state, connected: action.payload };
    default: return state;
  }
}

function initUIState(): UIState {
  const storedTheme = localStorage.getItem('theme');
  const theme: Theme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'dark';
  const storedLang = localStorage.getItem('lang');
  const lang: Lang = storedLang === 'zh' || storedLang === 'en' ? storedLang : 'zh';
  return {
    theme,
    lang,
    sidebarOpen: true,
    settingsOpen: false,
    panelAgent: null,
    panelMode: null,
    toasts: [],
    connected: false,
  };
}

interface UIContextValue {
  state: UIState;
  dispatch: Dispatch<UIAction>;
}

const UIContext = createContext<UIContextValue | null>(null);

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(uiReducer, null, initUIState);

  useEffect(() => { localStorage.setItem('theme', state.theme); document.documentElement.setAttribute('data-theme', state.theme); }, [state.theme]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) { // only if user hasn't manually set
        const t = e.matches ? 'dark' : 'light';
        dispatch({ type: 'SET_THEME', payload: t });
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  useEffect(() => { localStorage.setItem('lang', state.lang); }, [state.lang]);

  return (
    <UIContext.Provider value={{ state, dispatch }}>
      {children}
    </UIContext.Provider>
  );
}
