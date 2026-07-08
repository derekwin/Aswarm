import { createContext, useContext, useReducer, useEffect, type ReactNode, type Dispatch } from 'react';
import type { ConvMeta, Settings } from '@/types';
import { api } from '@/api';

interface AppState {
  conversations: Record<string, ConvMeta>;
  activeConvId: string | null;
  settings: Settings | null;
}

type AppAction =
  | { type: 'SET_CONVS'; payload: Record<string, ConvMeta> }
  | { type: 'ADD_CONV'; payload: ConvMeta }
  | { type: 'DEL_CONV'; payload: string }
  | { type: 'SET_ACTIVE'; payload: string }
  | { type: 'SET_TITLE'; payload: { id: string; title: string } }
  | { type: 'SET_SETTINGS'; payload: Settings };

const LAST_CONV_KEY = 'lastConvId';

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CONVS': {
      const ids = Object.keys(action.payload);
      if (ids.length === 0) return { ...state, conversations: action.payload };
      const savedId = localStorage.getItem(LAST_CONV_KEY);
      const active = savedId && action.payload[savedId] ? action.payload[savedId].id : ids[0];
      return { ...state, conversations: action.payload, activeConvId: active };
    }
    case 'ADD_CONV':
      return {
        ...state,
        conversations: { ...state.conversations, [action.payload.id]: action.payload },
        activeConvId: action.payload.id,
      };
    case 'DEL_CONV': {
      const { [action.payload]: _removed, ...rest } = state.conversations;
      void _removed;
      return {
        ...state,
        conversations: rest,
        activeConvId: state.activeConvId === action.payload ? null : state.activeConvId,
      };
    }
    case 'SET_ACTIVE':
      try { localStorage.setItem(LAST_CONV_KEY, action.payload); } catch { /* ignore */ }
      return { ...state, activeConvId: action.payload };
    case 'SET_TITLE':
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [action.payload.id]: { ...state.conversations[action.payload.id], title: action.payload.title },
        },
      };
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload };
    default:
      return state;
  }
}

function initAppState(): AppState {
  return { conversations: {}, activeConvId: null, settings: null };
}

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, null, initAppState);

  useEffect(() => {
    api.listConversations()
      .then(data => {
        const convs: Record<string, ConvMeta> = {};
        data.forEach(c => { convs[c.id] = c; });
        dispatch({ type: 'SET_CONVS', payload: convs });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.getSettings()
      .then(s => dispatch({ type: 'SET_SETTINGS', payload: s }))
      .catch(() => {});
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}
