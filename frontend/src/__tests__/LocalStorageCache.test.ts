import { describe, it, expect, beforeEach } from 'vitest';

const CONV_KEY_PREFIX = 'conv:';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface ConvSnapshot {
  messages: { role: string; content: string }[];
  agents: Record<string, { name: string; role: string; state: string; retryCount: number }>;
  dag: unknown;
  totalAgents: number;
  completedAgents: number;
  execState: string;
  error: string | null;
  errorCode: string | null;
  progress: { completed: number; total: number } | null;
  taskId: string | null;
  ts: number;
}

function saveSnapshot(convId: string, state: Omit<ConvSnapshot, 'ts'>): void {
  const snapshot: ConvSnapshot = { ...state, ts: Date.now() };
  localStorage.setItem(`${CONV_KEY_PREFIX}${convId}`, JSON.stringify(snapshot));
}

function loadSnapshot(convId: string, maxAge: number = CACHE_TTL): ConvSnapshot | null {
  try {
    const raw = localStorage.getItem(`${CONV_KEY_PREFIX}${convId}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as ConvSnapshot;
    if (Date.now() - entry.ts > maxAge) {
      localStorage.removeItem(`${CONV_KEY_PREFIX}${convId}`);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function makeSampleState(overrides: Partial<ConvSnapshot> = {}): Omit<ConvSnapshot, 'ts'> {
  return {
    messages: [{ role: 'user', content: 'Research AI chips' }],
    agents: {
      t1: { name: 'searcher', role: 'web_searcher', state: 'completed', retryCount: 0 },
      t2: { name: 'writer', role: 'writer', state: 'running', retryCount: 1 },
    },
    dag: { intent: 'research', subtasks: [], parallel_groups: [] },
    totalAgents: 2,
    completedAgents: 1,
    execState: 'streaming',
    error: null,
    errorCode: null,
    progress: { completed: 1, total: 2 },
    taskId: 'task_abc123',
    ...overrides,
  };
}

describe('LocalStorage conversation cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves conversation state to localStorage', () => {
    const state = makeSampleState();
    saveSnapshot('conv_001', state);

    const raw = localStorage.getItem('conv:conv_001');
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw!);
    expect(parsed.messages.length).toBe(1);
    expect(parsed.agents.t1.name).toBe('searcher');
    expect(parsed.execState).toBe('streaming');
    expect(parsed.taskId).toBe('task_abc123');
  });

  it('includes timestamp when saving', () => {
    const before = Date.now();
    saveSnapshot('conv_001', makeSampleState());
    const after = Date.now();

    const raw = localStorage.getItem('conv:conv_001')!;
    const parsed = JSON.parse(raw);
    expect(parsed.ts).toBeGreaterThanOrEqual(before);
    expect(parsed.ts).toBeLessThanOrEqual(after);
  });

  it('restores full conversation state from cache', () => {
    const state = makeSampleState({ execState: 'streaming', completedAgents: 1 });
    saveSnapshot('conv_002', state);

    const restored = loadSnapshot('conv_002');
    expect(restored).not.toBeNull();
    expect(restored!.execState).toBe('streaming');
    expect(restored!.completedAgents).toBe(1);
    expect(restored!.agents.t2.state).toBe('running');
    expect(restored!.progress).toEqual({ completed: 1, total: 2 });
  });

  it('returns null for unknown conversation', () => {
    const result = loadSnapshot('nonexistent');
    expect(result).toBeNull();
  });

  it('expires cache after TTL and removes it', () => {
    const oldState = makeSampleState();
    // Manually write a state with old timestamp
    const snapshot: ConvSnapshot = {
      ...oldState,
      ts: Date.now() - CACHE_TTL - 1000, // 1 second past TTL
    };
    localStorage.setItem('conv:conv_expired', JSON.stringify(snapshot));

    const result = loadSnapshot('conv_expired');
    expect(result).toBeNull();
    expect(localStorage.getItem('conv:conv_expired')).toBeNull(); // removed
  });

  it('still restores cache within TTL', () => {
    const validState = makeSampleState();
    const snapshot: ConvSnapshot = {
      ...validState,
      ts: Date.now() - 60_000, // 1 minute ago, well within TTL
    };
    localStorage.setItem('conv:conv_valid', JSON.stringify(snapshot));

    const result = loadSnapshot('conv_valid');
    expect(result).not.toBeNull();
    expect(result!.execState).toBe('streaming');
  });

  it('handles corrupted cache data gracefully', () => {
    localStorage.setItem('conv:conv_broken', '{not valid json');
    const result = loadSnapshot('conv_broken');
    expect(result).toBeNull();
  });

  it('saves and restores error state', () => {
    const errorState = makeSampleState({
      execState: 'failed',
      error: 'Connection timeout',
      errorCode: 'TIMEOUT',
    });
    saveSnapshot('conv_error', errorState);

    const restored = loadSnapshot('conv_error');
    expect(restored).not.toBeNull();
    expect(restored!.execState).toBe('failed');
    expect(restored!.error).toBe('Connection timeout');
    expect(restored!.errorCode).toBe('TIMEOUT');
  });

  it('saves and restores completed state', () => {
    const doneState = makeSampleState({
      execState: 'completed',
      completedAgents: 3,
      totalAgents: 3,
      progress: { completed: 3, total: 3 },
    });
    saveSnapshot('conv_done', doneState);

    const restored = loadSnapshot('conv_done');
    expect(restored!.execState).toBe('completed');
    expect(restored!.completedAgents).toBe(3);
    expect(restored!.progress).toEqual({ completed: 3, total: 3 });
  });

  it('handles multiple conversations independently', () => {
    saveSnapshot('conv_a', makeSampleState({ taskId: 'task_a' }));
    saveSnapshot('conv_b', makeSampleState({ taskId: 'task_b' }));

    const a = loadSnapshot('conv_a');
    const b = loadSnapshot('conv_b');
    expect(a!.taskId).toBe('task_a');
    expect(b!.taskId).toBe('task_b');
    expect(a!.taskId).not.toBe(b!.taskId);
  });

  it('overwrites existing cache on re-save', () => {
    saveSnapshot('conv_001', makeSampleState({ execState: 'streaming' }));
    expect(loadSnapshot('conv_001')!.execState).toBe('streaming');

    saveSnapshot('conv_001', makeSampleState({ execState: 'completed' }));
    expect(loadSnapshot('conv_001')!.execState).toBe('completed');
  });
});

describe('LocalStorage snapshot TTL variants', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('respects custom maxAge', () => {
    const state = makeSampleState();
    const snapshot: ConvSnapshot = { ...state, ts: Date.now() - 10_000 };
    localStorage.setItem('conv:conv_ttl', JSON.stringify(snapshot));

    // With 5s TTL, should be expired
    const expired = loadSnapshot('conv_ttl', 5_000);
    expect(expired).toBeNull();

    // Re-write with fresh timestamp for 30s TTL test
    const freshSnapshot: ConvSnapshot = { ...state, ts: Date.now() - 5_000 };
    localStorage.setItem('conv:conv_ttl2', JSON.stringify(freshSnapshot));
    const valid = loadSnapshot('conv_ttl2', 30_000);
    expect(valid).not.toBeNull();
  });
});
