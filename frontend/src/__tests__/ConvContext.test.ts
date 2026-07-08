import { describe, it, expect } from 'vitest';

// Test the transitionState function directly
const VALID_TRANSITIONS: Record<string, string[]> = {
  idle: ['connecting'],
  connecting: ['decomposing', 'failed'],
  decomposing: ['streaming', 'failed'],
  streaming: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: ['connecting'],
  cancelled: ['connecting'],
};

function transitionState(current: string, next: string): string {
  const allowed = VALID_TRANSITIONS[current];
  if (allowed && allowed.includes(next)) return next;
  return current;
}

describe('TaskExecutionState Machine', () => {
  it('allows idle → connecting', () => {
    expect(transitionState('idle', 'connecting')).toBe('connecting');
  });

  it('allows connecting → decomposing', () => {
    expect(transitionState('connecting', 'decomposing')).toBe('decomposing');
  });

  it('allows decomposing → streaming', () => {
    expect(transitionState('decomposing', 'streaming')).toBe('streaming');
  });

  it('allows streaming → completed', () => {
    expect(transitionState('streaming', 'completed')).toBe('completed');
  });

  it('allows streaming → failed', () => {
    expect(transitionState('streaming', 'failed')).toBe('failed');
  });

  it('allows streaming → cancelled', () => {
    expect(transitionState('streaming', 'cancelled')).toBe('cancelled');
  });

  it('blocks idle → streaming (skip states)', () => {
    expect(transitionState('idle', 'streaming')).toBe('idle');
  });

  it('blocks completed → anything', () => {
    expect(transitionState('completed', 'streaming')).toBe('completed');
    expect(transitionState('completed', 'idle')).toBe('completed');
  });

  it('allows failed → connecting (retry)', () => {
    expect(transitionState('failed', 'connecting')).toBe('connecting');
  });

  it('blocks cancelled → completed', () => {
    expect(transitionState('cancelled', 'completed')).toBe('cancelled');
  });

  it('full happy path: idle → connecting → decomposing → streaming → completed', () => {
    let state = 'idle';
    state = transitionState(state, 'connecting');
    expect(state).toBe('connecting');
    state = transitionState(state, 'decomposing');
    expect(state).toBe('decomposing');
    state = transitionState(state, 'streaming');
    expect(state).toBe('streaming');
    state = transitionState(state, 'completed');
    expect(state).toBe('completed');
  });

  it('retry path: streaming → failed → connecting → decomposing → streaming → completed', () => {
    let state = 'streaming';
    state = transitionState(state, 'failed');
    expect(state).toBe('failed');
    state = transitionState(state, 'connecting');
    expect(state).toBe('connecting');
    state = transitionState(state, 'decomposing');
    expect(state).toBe('decomposing');
    state = transitionState(state, 'streaming');
    expect(state).toBe('streaming');
    state = transitionState(state, 'completed');
    expect(state).toBe('completed');
  });
});
