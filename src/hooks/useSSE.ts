"use client";

import { useRef, useEffect, useCallback } from "react";
import type { Agent } from "@/types";

type SSECallback = (event: Record<string, unknown>) => void;

export function useSSE() {
  const eventSource = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const callbackRef = useRef<SSECallback>(() => {});

  const connect = useCallback((taskId: string) => {
    eventSource.current?.close();
    clearTimeout(reconnectTimer.current);

    const es = new EventSource(`http://${window.location.hostname}:8001/events/${taskId}`);
    eventSource.current = es;

    es.onmessage = (ev) => {
      try {
        callbackRef.current(JSON.parse(ev.data));
      } catch { /* malformed */ }
    };

    es.onerror = () => {
      es.close();
      reconnectTimer.current = setTimeout(() => connect(taskId), 2000);
    };
  }, []);

  const disconnect = useCallback(() => {
    eventSource.current?.close();
    clearTimeout(reconnectTimer.current);
  }, []);

  const setCallback = useCallback((cb: SSECallback) => {
    callbackRef.current = cb;
  }, []);

  useEffect(() => {
    return () => {
      eventSource.current?.close();
      clearTimeout(reconnectTimer.current);
    };
  }, []);

  return { connect, disconnect, setCallback };
}
