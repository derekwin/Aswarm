"use client";

import { useRef, useEffect, useCallback } from "react";

type SSECallback = (event: Record<string, unknown>) => void;

export function useSSE() {
  const eventSource = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const callbackRef = useRef<SSECallback>(() => {});
  const shouldReconnect = useRef(true);

  const connect = useCallback((taskId: string) => {
    eventSource.current?.close();
    clearTimeout(reconnectTimer.current);
    shouldReconnect.current = true;

    const es = new EventSource(`http://${window.location.hostname}:8001/events/${taskId}`);
    eventSource.current = es;

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        // Stop reconnecting on terminal events
        if (data.type === "done" || data.type === "error") {
          shouldReconnect.current = false;
        }
        callbackRef.current(data);
      } catch { /* malformed */ }
    };

    es.onerror = () => {
      es.close();
      if (shouldReconnect.current) {
        reconnectTimer.current = setTimeout(() => connect(taskId), 2000);
      }
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
