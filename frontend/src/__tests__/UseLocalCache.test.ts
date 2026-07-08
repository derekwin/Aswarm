import { describe, it, expect, beforeEach } from 'vitest';

const CACHE_KEY_PREFIX = 'cache:';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

function saveCache<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  localStorage.setItem(`${CACHE_KEY_PREFIX}${key}`, JSON.stringify(entry));
}

function loadCache<T>(key: string, maxAge: number = CACHE_TTL): T | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.timestamp > maxAge) {
      localStorage.removeItem(`${CACHE_KEY_PREFIX}${key}`);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

describe('useLocalCache — generic cache hook logic', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves cached data', () => {
    saveCache('settings', { llm_base_url: 'http://localhost:11434/v1', default_model: 'qwen3:8b' });
    const result = loadCache<{ llm_base_url: string; default_model: string }>('settings');
    expect(result).not.toBeNull();
    expect(result!.llm_base_url).toBe('http://localhost:11434/v1');
    expect(result!.default_model).toBe('qwen3:8b');
  });

  it('returns null when no cache exists', () => {
    const result = loadCache('nonexistent');
    expect(result).toBeNull();
  });

  it('expires cache after TTL and removes entry', () => {
    const entry: CacheEntry<string> = {
      data: 'stale data',
      timestamp: Date.now() - CACHE_TTL - 1000,
    };
    localStorage.setItem(`${CACHE_KEY_PREFIX}ttl_test`, JSON.stringify(entry));

    const result = loadCache<string>('ttl_test');
    expect(result).toBeNull();
    expect(localStorage.getItem(`${CACHE_KEY_PREFIX}ttl_test`)).toBeNull();
  });

  it('returns valid data within TTL', () => {
    const entry: CacheEntry<string[]> = {
      data: ['conv1', 'conv2', 'conv3'],
      timestamp: Date.now() - 60_000, // 1 minute ago
    };
    localStorage.setItem(`${CACHE_KEY_PREFIX}conv_list`, JSON.stringify(entry));

    const result = loadCache<string[]>('conv_list');
    expect(result).toEqual(['conv1', 'conv2', 'conv3']);
  });

  it('handles corrupted cache data gracefully', () => {
    localStorage.setItem(`${CACHE_KEY_PREFIX}broken`, '{invalid json');
    const result = loadCache('broken');
    expect(result).toBeNull();
  });

  it('respects custom maxAge parameter', () => {
    const entry: CacheEntry<number> = {
      data: 42,
      timestamp: Date.now() - 10_000, // 10 seconds ago
    };
    localStorage.setItem(`${CACHE_KEY_PREFIX}custom_ttl`, JSON.stringify(entry));

    // With 5s TTL (shorter than 10s), should be expired
    const expired = loadCache<number>('custom_ttl', 5_000);
    expect(expired).toBeNull();

    // Re-save and test with 30s TTL (longer than 10s)
    const freshEntry: CacheEntry<number> = { data: 99, timestamp: Date.now() - 10_000 };
    localStorage.setItem(`${CACHE_KEY_PREFIX}custom_ttl2`, JSON.stringify(freshEntry));
    const valid = loadCache<number>('custom_ttl2', 30_000);
    expect(valid).toBe(99);
  });

  it('overwrites existing cache on re-save', () => {
    saveCache('counter', 1);
    expect(loadCache<number>('counter')).toBe(1);

    saveCache('counter', 2);
    expect(loadCache<number>('counter')).toBe(2);
  });

  it('handles different data types consistently', () => {
    saveCache('str_val', 'hello');
    saveCache('num_val', 123);
    saveCache('arr_val', [1, 2, 3]);
    saveCache('obj_val', { nested: { key: 'value' } });
    saveCache('bool_val', true);

    expect(loadCache<string>('str_val')).toBe('hello');
    expect(loadCache<number>('num_val')).toBe(123);
    expect(loadCache<number[]>('arr_val')).toEqual([1, 2, 3]);
    expect(loadCache<{ nested: { key: string } }>('obj_val')).toEqual({ nested: { key: 'value' } });
    expect(loadCache<boolean>('bool_val')).toBe(true);
  });

  it('stale-while-revalidate: returns cached data even during background refresh', () => {
    // Simulate the pattern: cache is read first, fetcher runs in background
    saveCache('stale_test', { version: 1 });

    // Read cached data immediately (simulates fast render)
    const cached = loadCache<{ version: number }>('stale_test');
    expect(cached).not.toBeNull();
    expect(cached!.version).toBe(1);

    // Background fetch completes, overwrites cache
    saveCache('stale_test', { version: 2 });

    // Next read sees updated data
    const updated = loadCache<{ version: number }>('stale_test');
    expect(updated!.version).toBe(2);
  });
});
