import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';
import type { Message, AgentState, DAGData, ActivityEntry, TaskExecState } from '@/types';

interface ConvState {
  messages: Message[];
  agents: Record<string, AgentState>;
  dag: DAGData | null;
  activity: ActivityEntry[];
  totalAgents: number;
  completedAgents: number;
  execState: TaskExecState;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  progress: { completed: number; total: number } | null;
  taskId: string | null;
  _fromCache?: boolean;       // restored from localStorage, needs backend sync
  _lastEventId?: number;       // last processed SSE event_id for dedup
  _completedSet?: string[];    // tracked completed agent IDs for dedup (array for JSON serialization)
}

function initConvState(): ConvState {
  return {
    messages: [],
    agents: {},
    dag: null,
    activity: [],
    totalAgents: 0,
    completedAgents: 0,
    execState: 'idle',
    loading: false,
    error: null,
    errorCode: null,
    progress: null,
    taskId: null,
    _fromCache: undefined,
    _lastEventId: undefined,
    _completedSet: [],
  };
}

const VALID_TRANSITIONS: Record<TaskExecState, TaskExecState[]> = {
  idle: ['connecting', 'completed', 'failed'],
  connecting: ['decomposing', 'cancelled', 'failed'],
  decomposing: ['streaming', 'cancelled', 'failed'],
  streaming: ['completed', 'failed', 'cancelled', 'reconnecting'],
  reconnecting: ['streaming', 'completed', 'failed'],
  completed: [],
  failed: ['connecting'],
  cancelled: ['connecting'],
};

type ConvAction =
  | { type: 'RESET' }
  | { type: 'LOAD'; payload: { messages: Message[] } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'APPEND_MSG'; payload: Message }
  | { type: 'UPDATE_LAST_MSG'; payload: Partial<Message> }
  | { type: 'SET_DAG'; payload: { dag: DAGData; totalAgents: number } }
  | { type: 'UPDATE_AGENT'; payload: { id: string; data: Partial<AgentState> } }
  | { type: 'INCREMENT_COMPLETED'; payload?: { subtaskId: string } }
  | { type: 'APPEND_ACTIVITY'; payload: ActivityEntry }
  | { type: 'SET_EXEC_STATE'; payload: TaskExecState }
  | { type: 'SET_ERROR'; payload: { message: string; code?: string } }
  | { type: 'SET_PROGRESS'; payload: { completed: number; total: number } }
  | { type: 'SET_TASK_ID'; payload: string }
  | { type: 'SET_LAST_EVENT_ID'; payload: number }
  | { type: 'SET_FROM_CACHE'; payload: boolean }
  | { type: 'RESTORE_SNAPSHOT'; payload: Partial<ConvState> & { _fromCache?: boolean } };

function transitionState(current: TaskExecState, next: TaskExecState): TaskExecState {
  const allowed = VALID_TRANSITIONS[current];
  if (allowed && allowed.includes(next)) return next;
  console.warn(
    `[StateMachine] Illegal transition: ${current} → ${next}`,
    { timestamp: Date.now() }
  );
  return current;
}

function convReducer(state: ConvState, action: ConvAction): ConvState {
  switch (action.type) {
    case 'RESET':
      return { ...initConvState(), _completedSet: undefined };
    case 'LOAD':
      return { ...state, messages: action.payload.messages, loading: false };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'APPEND_MSG':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'UPDATE_LAST_MSG': {
      const msgs = [...state.messages];
      if (msgs.length && msgs[msgs.length - 1].role === 'assistant') {
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...action.payload };
      } else {
        msgs.push({ role: 'assistant', content: action.payload.content || '', ...action.payload });
      }
      return { ...state, messages: msgs };
    }
    case 'SET_DAG':
      return { ...state, dag: action.payload.dag, totalAgents: action.payload.totalAgents, completedAgents: 0, agents: {}, progress: null };
    case 'UPDATE_AGENT':
      return {
        ...state,
        agents: {
          ...state.agents,
          [action.payload.id]: { ...(state.agents[action.payload.id] || {} as AgentState), ...action.payload.data },
        },
      };
    case 'INCREMENT_COMPLETED': {
      const sid = action.payload?.subtaskId;
      if (sid && state._completedSet?.includes(sid)) return state;
      return {
        ...state,
        completedAgents: state.completedAgents + 1,
        _completedSet: sid ? [...(state._completedSet || []), sid] : state._completedSet,
      };
    }
    case 'SET_LAST_EVENT_ID':
      return { ...state, _lastEventId: action.payload };
    case 'SET_FROM_CACHE':
      return { ...state, _fromCache: action.payload };
    case 'APPEND_ACTIVITY':
      return { ...state, activity: [...state.activity, action.payload].slice(-50) };
    case 'SET_EXEC_STATE':
      return { ...state, execState: transitionState(state.execState, action.payload) };
    case 'SET_ERROR':
      return { ...state, error: action.payload.message, errorCode: action.payload.code || null };
    case 'SET_PROGRESS':
      return { ...state, progress: action.payload };
    case 'SET_TASK_ID':
      return { ...state, taskId: action.payload };
    case 'RESTORE_SNAPSHOT':
      return { ...state, ...action.payload, loading: false, _fromCache: action.payload._fromCache ?? true };
    default:
      return state;
  }
}

interface ConvContextValue {
  state: ConvState;
  dispatch: Dispatch<ConvAction>;
}

const ConvContext = createContext<ConvContextValue | null>(null);

export function useConv(): ConvContextValue {
  const ctx = useContext(ConvContext);
  if (!ctx) throw new Error('useConv must be used within ConvProvider');
  return ctx;
}

export function ConvProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(convReducer, null, initConvState);
  return (
    <ConvContext.Provider value={{ state, dispatch }}>
      {children}
    </ConvContext.Provider>
  );
}
