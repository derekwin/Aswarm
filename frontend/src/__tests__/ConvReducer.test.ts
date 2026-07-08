import { describe, it, expect } from 'vitest';
import type { TaskExecState, Message, AgentState, DAGData } from '@/types';

// Replicate the reducer and transition logic for direct testing
const VALID_TRANSITIONS: Record<TaskExecState, TaskExecState[]> = {
  idle: ['connecting'],
  connecting: ['decomposing', 'failed'],
  decomposing: ['streaming', 'failed'],
  streaming: ['completed', 'failed', 'cancelled'],
  reconnecting: ['streaming', 'completed', 'failed'],
  completed: [],
  failed: ['connecting'],
  cancelled: ['connecting'],
};

function transitionState(current: TaskExecState, next: TaskExecState): TaskExecState {
  const allowed = VALID_TRANSITIONS[current];
  if (allowed && allowed.includes(next)) return next;
  return current;
}

interface ConvState {
  messages: Message[];
  agents: Record<string, AgentState>;
  dag: DAGData | null;
  totalAgents: number;
  completedAgents: number;
  execState: TaskExecState;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  progress: { completed: number; total: number } | null;
  taskId: string | null;
  _fromCache?: boolean;
  _lastEventId?: number;
  _completedSet?: string[];
}

function initConvState(): ConvState {
  return {
    messages: [], agents: {}, dag: null, totalAgents: 0, completedAgents: 0,
    execState: 'idle', loading: false, error: null, errorCode: null,
    progress: null, taskId: null, _completedSet: [],
  };
}

type ConvAction =
  | { type: 'RESET' }
  | { type: 'LOAD'; payload: { messages: Message[] } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'APPEND_MSG'; payload: Message }
  | { type: 'UPDATE_LAST_MSG'; payload: Partial<Message> }
  | { type: 'SET_DAG'; payload: { dag: DAGData; totalAgents: number } }
  | { type: 'UPDATE_AGENT'; payload: { id: string; data: Partial<AgentState> } }
  | { type: 'INCREMENT_COMPLETED'; payload?: { subtaskId: string } }
  | { type: 'SET_EXEC_STATE'; payload: TaskExecState }
  | { type: 'SET_ERROR'; payload: { message: string; code?: string } }
  | { type: 'SET_PROGRESS'; payload: { completed: number; total: number } }
  | { type: 'SET_TASK_ID'; payload: string }
  | { type: 'SET_LAST_EVENT_ID'; payload: number }
  | { type: 'SET_FROM_CACHE'; payload: boolean }
  | { type: 'RESTORE_SNAPSHOT'; payload: Partial<ConvState> & { _fromCache?: boolean } };

function convReducer(state: ConvState, action: ConvAction): ConvState {
  switch (action.type) {
    case 'RESET': return initConvState();
    case 'LOAD': return { ...state, messages: action.payload.messages, loading: false };
    case 'SET_LOADING': return { ...state, loading: action.payload };
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
      return { ...state, dag: action.payload.dag, totalAgents: action.payload.totalAgents,
               completedAgents: 0, agents: {}, progress: null };
    case 'UPDATE_AGENT':
      return { ...state, agents: {
        ...state.agents,
        [action.payload.id]: { ...(state.agents[action.payload.id] || {} as AgentState), ...action.payload.data },
      }};
    case 'INCREMENT_COMPLETED': {
      const sid = action.payload?.subtaskId;
      if (sid && state._completedSet?.includes(sid)) return state;
      return {
        ...state,
        completedAgents: state.completedAgents + 1,
        _completedSet: sid ? [...(state._completedSet || []), sid] : state._completedSet,
      };
    }
    case 'SET_EXEC_STATE':
      return { ...state, execState: transitionState(state.execState, action.payload) };
    case 'SET_ERROR':
      return { ...state, error: action.payload.message, errorCode: action.payload.code || null };
    case 'SET_PROGRESS':
      return { ...state, progress: action.payload };
    case 'SET_TASK_ID':
      return { ...state, taskId: action.payload };
    case 'SET_LAST_EVENT_ID':
      return { ...state, _lastEventId: action.payload };
    case 'SET_FROM_CACHE':
      return { ...state, _fromCache: action.payload };
    case 'RESTORE_SNAPSHOT':
      return { ...state, ...action.payload, loading: false, _fromCache: action.payload._fromCache ?? true };
    default: return state;
  }
}

const SAMPLE_DAG: DAGData = {
  intent: 'research',
  subtasks: [
    { id: 't1', name: 'searcher', role: 'web_searcher', tools: ['search_engine'], depends_on: [] },
    { id: 't2', name: 'writer', role: 'writer', tools: ['file_writer'], depends_on: ['t1'] },
  ],
  parallel_groups: [['t1'], ['t2']],
};

describe('ConvReducer - SSE event simulation', () => {
  it('simulates full SSE flow: idle → connecting → decomposing → streaming → completed', () => {
    let state = initConvState();

    // User submits task
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'connecting' });
    state = convReducer(state, { type: 'APPEND_MSG', payload: { role: 'user', content: 'Research AI chips' } });
    expect(state.execState).toBe('connecting');
    expect(state.messages.length).toBe(1);

    // SSE: decomposing status
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'decomposing' });
    state = convReducer(state, { type: 'UPDATE_LAST_MSG', payload: { content: 'Decomposing task...', typing: true } });
    expect(state.execState).toBe('decomposing');

    // SSE: DAG received
    state = convReducer(state, { type: 'SET_DAG', payload: { dag: SAMPLE_DAG, totalAgents: 2 } });
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'streaming' });
    expect(state.dag).not.toBeNull();
    expect(state.dag!.subtasks.length).toBe(2);
    expect(state.execState).toBe('streaming');

    // SSE: agent_start for t1
    state = convReducer(state, { type: 'UPDATE_AGENT', payload: {
      id: 't1', data: { name: 'searcher', role: 'web_searcher', state: 'running', retryCount: 0, subtaskId: 't1' },
    }});
    expect(state.agents['t1'].state).toBe('running');

    // SSE: agent_done for t1
    state = convReducer(state, { type: 'UPDATE_AGENT', payload: {
      id: 't1', data: { state: 'completed', output: 'market data', retryCount: 0, subtaskId: 't1' },
    }});
    state = convReducer(state, { type: 'INCREMENT_COMPLETED' });
    expect(state.agents['t1'].state).toBe('completed');
    expect(state.completedAgents).toBe(1);

    // SSE: progress update
    state = convReducer(state, { type: 'SET_PROGRESS', payload: { completed: 1, total: 2 } });
    expect(state.progress?.completed).toBe(1);

    // SSE: agent_start t2
    state = convReducer(state, { type: 'UPDATE_AGENT', payload: {
      id: 't2', data: { name: 'writer', role: 'writer', state: 'running', retryCount: 0, subtaskId: 't2' },
    }});

    // SSE: agent_done t2
    state = convReducer(state, { type: 'UPDATE_AGENT', payload: {
      id: 't2', data: { state: 'completed', output: 'report', retryCount: 0, subtaskId: 't2' },
    }});
    state = convReducer(state, { type: 'INCREMENT_COMPLETED' });
    state = convReducer(state, { type: 'SET_PROGRESS', payload: { completed: 2, total: 2 } });
    expect(state.completedAgents).toBe(2);

    // SSE: done event
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'completed' });
    state = convReducer(state, { type: 'APPEND_MSG', payload: { role: 'assistant', content: '# Result Summary\n\n2/2 completed' } });
    expect(state.execState).toBe('completed');
    expect(state.messages.some(m => m.role === 'assistant')).toBe(true);
  });

  it('simulates SSE error flow: streaming → failed', () => {
    let state = initConvState();
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'connecting' });
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'decomposing' });
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'streaming' });
    expect(state.execState).toBe('streaming');

    // SSE error event
    state = convReducer(state, { type: 'SET_ERROR', payload: { message: 'Connection timeout', code: 'TIMEOUT' } });
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'failed' });
    expect(state.execState).toBe('failed');
    expect(state.error).toBe('Connection timeout');
    expect(state.errorCode).toBe('TIMEOUT');
  });

  it('simulates cancel flow: streaming → cancelled', () => {
    let state = initConvState();
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'connecting' });
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'decomposing' });
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'streaming' });
    state = convReducer(state, { type: 'SET_EXEC_STATE', payload: 'cancelled' });
    expect(state.execState).toBe('cancelled');
  });

  it('handles agent update for unknown subtask', () => {
    let state = initConvState();
    state = convReducer(state, { type: 'UPDATE_AGENT', payload: {
      id: 'unknown', data: { state: 'pending' },
    }});
    expect(state.agents['unknown']).toBeDefined();
    expect(state.agents['unknown'].state).toBe('pending');
  });

  it('handles RESET from streaming state', () => {
    let state = initConvState();
    state = { ...state, execState: 'streaming', messages: [{ role: 'user', content: 'test' }], agents: { t1: { name: 'a', role: 'r', state: 'running', retryCount: 0 } }, taskId: 'task_123' };
    state = convReducer(state, { type: 'RESET' });
    expect(state.execState).toBe('idle');
    expect(state.messages).toEqual([]);
    expect(state.agents).toEqual({});
    expect(state.taskId).toBeNull();
  });

  it('RESTORE_SNAPSHOT restores full state and sets loading false', () => {
    const snapshot: ConvState = {
      messages: [{ role: 'user', content: 'hello' }],
      agents: { t1: { name: 'searcher', role: 'web_searcher', state: 'completed', retryCount: 0 } },
      dag: SAMPLE_DAG,
      totalAgents: 2,
      completedAgents: 1,
      execState: 'streaming',
      loading: true,
      error: null,
      errorCode: null,
      progress: { completed: 1, total: 2 },
      taskId: 'task_abc',
    };
    let state = initConvState();
    state = convReducer(state, { type: 'RESTORE_SNAPSHOT', payload: snapshot });
    expect(state.execState).toBe('streaming');
    expect(state.loading).toBe(false);
    expect(state.messages.length).toBe(1);
    expect(state.dag).not.toBeNull();
  });
});

describe('TaskExecutionState Machine - edge cases', () => {
  it('blocks idle → completed', () => {
    expect(transitionState('idle', 'completed')).toBe('idle');
  });

  it('blocks idle → streaming', () => {
    expect(transitionState('idle', 'streaming')).toBe('idle');
  });

  it('blocks connecting → completed (must go through decomposing/streaming)', () => {
    expect(transitionState('connecting', 'completed')).toBe('connecting');
  });

  it('completed terminal state blocks all transitions', () => {
    expect(transitionState('completed', 'streaming')).toBe('completed');
    expect(transitionState('completed', 'failed')).toBe('completed');
    expect(transitionState('completed', 'connecting')).toBe('completed');
  });

  it('allows retry from failed → connecting → decomposing', () => {
    let s = transitionState('failed', 'connecting');
    expect(s).toBe('connecting');
    s = transitionState(s, 'decomposing');
    expect(s).toBe('decomposing');
  });
});

describe('ConvReducer - SET_DAG behavior', () => {
  it('SET_DAG resets progress, agents, and completedAgents', () => {
    let state = initConvState();
    state = { ...state, completedAgents: 5, agents: { old: { name: 'old', role: 'r', state: 'completed', retryCount: 0 } }, progress: { completed: 3, total: 5 } };
    state = convReducer(state, { type: 'SET_DAG', payload: { dag: SAMPLE_DAG, totalAgents: 2 } });
    expect(state.completedAgents).toBe(0);
    expect(state.agents).toEqual({});
    expect(state.progress).toBeNull();
    expect(state.totalAgents).toBe(2);
  });
});

describe('ConvReducer - UPDATE_LAST_MSG behavior', () => {
  it('appends when last message is not assistant', () => {
    let state = initConvState();
    state = convReducer(state, { type: 'APPEND_MSG', payload: { role: 'user', content: 'hello' } });
    state = convReducer(state, { type: 'UPDATE_LAST_MSG', payload: { content: 'thinking...', typing: true } });
    expect(state.messages.length).toBe(2);
    expect(state.messages[1].role).toBe('assistant');
  });

  it('updates last message when it is assistant', () => {
    let state = initConvState();
    state = convReducer(state, { type: 'APPEND_MSG', payload: { role: 'assistant', content: 'thinking...' } });
    state = convReducer(state, { type: 'UPDATE_LAST_MSG', payload: { content: 'decomposing...', typing: true } });
    expect(state.messages.length).toBe(1);
    expect(state.messages[0].content).toBe('decomposing...');
  });
});
