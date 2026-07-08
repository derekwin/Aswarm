import { describe, it, expect } from 'vitest';
import type { SSEEvent } from '@/types';

interface AgentRec {
  name: string; role: string; state: string; retryCount: number;
  subtaskId?: string; output?: string; error?: string;
}

interface SimState {
  agents: Record<string, AgentRec>;
  totalAgents: number;
  completedAgents: number;
  execState: string;
  progress: { completed: number; total: number } | null;
  error: string | null;
  errorCode: string | null;
}

function fresh(): SimState {
  return { agents: {}, totalAgents: 0, completedAgents: 0,
    execState: 'idle', progress: null, error: null, errorCode: null };
}

function handleEvent(state: SimState, event: SSEEvent, calls: string[]): SimState {
  switch (event.type) {
    case 'status':
      calls.push('UPDATE_LAST_MSG');
      break;
    case 'exec_state':
      calls.push('SET_EXEC_STATE');
      state.execState = event.state;
      break;
    case 'dag':
      calls.push('SET_DAG');
      calls.push('SET_EXEC_STATE');
      state.totalAgents = event.subtasks.length;
      state.completedAgents = 0;
      state.agents = {};
      state.execState = 'streaming';
      break;
    case 'agent_start':
      calls.push('UPDATE_AGENT');
      state.agents[event.subtask_id] = { name: event.agent_name, role: event.role, state: 'running', retryCount: 0 };
      break;
    case 'agent_done':
      calls.push('UPDATE_AGENT');
      state.agents[event.subtask_id] = { ...state.agents[event.subtask_id], state: event.state, output: event.output, error: event.error, retryCount: event.retry_count };
      if (event.state === 'completed' || event.state === 'failed') {
        calls.push('INCREMENT_COMPLETED');
        state.completedAgents++;
      }
      break;
    case 'tool_call':
      calls.push('SET_TOOL_CALL');
      break;
    case 'progress':
      calls.push('SET_PROGRESS');
      state.progress = { completed: event.completed, total: event.total };
      break;
    case 'done':
      calls.push('SET_EXEC_STATE');
      state.execState = 'completed';
      break;
    case 'error':
      calls.push('SET_ERROR');
      calls.push('SET_EXEC_STATE');
      state.error = event.msg;
      state.errorCode = event.code || null;
      state.execState = 'failed';
      break;
  }
  return state;
}

describe('SSE Event Handler — full flow', () => {
  it('status → dag → agent_start → agent_done → progress → done', () => {
    const calls: string[] = [];
    let s = fresh();

    s = handleEvent(s, { type: 'exec_state', state: 'decomposing' }, calls);
    expect(s.execState).toBe('decomposing');

    s = handleEvent(s, { type: 'dag', intent: 'research',
      subtasks: [{ id: 't1', name: 'a', role: 'coder', tools: [], depends_on: [] }],
      parallel_groups: [['t1']] }, calls);
    expect(s.execState).toBe('streaming');
    expect(s.totalAgents).toBe(1);

    s = handleEvent(s, { type: 'agent_start', subtask_id: 't1', agent_name: 'a', role: 'coder' }, calls);
    expect(s.agents['t1'].state).toBe('running');

    s = handleEvent(s, { type: 'agent_done', subtask_id: 't1', state: 'completed', output: 'ok', retry_count: 0 }, calls);
    expect(s.agents['t1'].state).toBe('completed');
    expect(s.completedAgents).toBe(1);

    s = handleEvent(s, { type: 'progress', completed: 1, total: 1 }, calls);
    expect(s.progress?.completed).toBe(1);

    s = handleEvent(s, { type: 'done' }, calls);
    expect(s.execState).toBe('completed');

    expect(calls).toContain('SET_DAG');
    expect(calls).toContain('UPDATE_AGENT');
    expect(calls).toContain('INCREMENT_COMPLETED');
    expect(calls).toContain('SET_PROGRESS');
  });

  it('error event sets failed state', () => {
    const calls: string[] = [];
    let s = fresh();
    s.execState = 'streaming';
    s = handleEvent(s, { type: 'error', msg: 'timeout', code: 'TIMEOUT' }, calls);
    expect(s.execState).toBe('failed');
    expect(s.error).toBe('timeout');
    expect(s.errorCode).toBe('TIMEOUT');
  });

  it('agent_done with failed still increments completed', () => {
    const calls: string[] = [];
    let s = fresh();
    s.agents['t1'] = { name: 'a', role: 'r', state: 'running', retryCount: 0 };
    s = handleEvent(s, { type: 'agent_done', subtask_id: 't1', state: 'failed', error: 'err', retry_count: 0 }, calls);
    expect(s.agents['t1'].state).toBe('failed');
    expect(s.completedAgents).toBe(1);
  });

  it('tool_call dispatches correctly', () => {
    const calls: string[] = [];
    const s = fresh();
    handleEvent(s, { type: 'tool_call', agent_name: 'searcher', tool: 'search_engine', args: '{}' }, calls);
    expect(calls).toContain('SET_TOOL_CALL');
  });

  it('parallel agents start and finish correctly', () => {
    const calls: string[] = [];
    let s = fresh();
    s = handleEvent(s, { type: 'agent_start', subtask_id: 't1', agent_name: 'a1', role: 'coder' }, calls);
    s = handleEvent(s, { type: 'agent_start', subtask_id: 't2', agent_name: 'a2', role: 'writer' }, calls);
    expect(s.agents['t1'].state).toBe('running');
    expect(s.agents['t2'].state).toBe('running');
    s = handleEvent(s, { type: 'agent_done', subtask_id: 't1', state: 'completed', retry_count: 0 }, calls);
    s = handleEvent(s, { type: 'agent_done', subtask_id: 't2', state: 'completed', retry_count: 0 }, calls);
    expect(s.completedAgents).toBe(2);
  });

  it('dag resets agents and completed count', () => {
    const calls: string[] = [];
    let s = fresh();
    s.agents['old'] = { name: 'old', role: 'r', state: 'completed', retryCount: 0 };
    s.completedAgents = 5;
    s = handleEvent(s, { type: 'dag', intent: 't', subtasks: [], parallel_groups: [] }, calls);
    expect(s.completedAgents).toBe(0);
    expect(Object.keys(s.agents)).toHaveLength(0);
  });

  it('exec_state transitions state correctly', () => {
    const calls: string[] = [];
    let s = fresh();
    s = handleEvent(s, { type: 'exec_state', state: 'decomposing' }, calls);
    expect(s.execState).toBe('decomposing');
    expect(calls).toContain('SET_EXEC_STATE');

    s = handleEvent(s, { type: 'exec_state', state: 'streaming' }, calls);
    expect(s.execState).toBe('streaming');

    s = handleEvent(s, { type: 'exec_state', state: 'completed' }, calls);
    expect(s.execState).toBe('completed');
  });
});
