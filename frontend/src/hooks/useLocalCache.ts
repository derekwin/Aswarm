import { useState, useEffect, useCallback } from 'react';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000;

export function useLocalCache<T>(key: string, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (Date.now() - entry.timestamp > CACHE_TTL) {
        localStorage.removeItem(key);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(!data);

  const refresh = useCallback(async () => {
    try {
      const fresh = await fetcher();
      setData(fresh);
      localStorage.setItem(key, JSON.stringify({ data: fresh, timestamp: Date.now() }));
    } catch { /* keep stale */ }
  }, [key, fetcher]);

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then(fresh => {
        if (cancelled) return;
        setData(fresh);
        localStorage.setItem(key, JSON.stringify({ data: fresh, timestamp: Date.now() }));
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading: !data && loading, refresh };
}
