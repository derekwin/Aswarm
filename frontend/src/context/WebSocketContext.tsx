import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';

type WSEventHandler = (event: Record<string, unknown>) => void;

export interface WebSocketContextValue {
  connected: boolean;
  subscribe: (taskId: string) => void;
  unsubscribe: (taskId: string) => void;
  cancel: (taskId: string) => void;
  registerHandler: (taskId: string, handler: WSEventHandler) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];
const PING_INTERVAL = 30000;
const PONG_TIMEOUT = 60000;

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, WSEventHandler>>(new Map());
  const subscribedRef = useRef<Set<string>>(new Set());
  const reconnectAttemptRef = useRef(0);
  const pingTimerRef = useRef<ReturnType<typeof setInterval>>();
  const pongTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const intentionalCloseRef = useRef(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptRef.current = 0;

      for (const taskId of subscribedRef.current) {
        ws.send(JSON.stringify({ action: 'subscribe', task_id: taskId }));
      }

      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'ping' }));
          pongTimerRef.current = setTimeout(() => {
            ws.close();
          }, PONG_TIMEOUT);
        }
      }, PING_INTERVAL);
    };

    ws.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);

        if (data.type === 'pong') {
          if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
          return;
        }

        const taskId = data.task_id as string | undefined;
        if (taskId) {
          const handler = handlersRef.current.get(taskId);
          if (handler) handler(data);
        }
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      if (pongTimerRef.current) clearTimeout(pongTimerRef.current);

      if (intentionalCloseRef.current) return;

      const delay = RECONNECT_DELAYS[Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)];
      reconnectAttemptRef.current++;
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      intentionalCloseRef.current = true;
      wsRef.current?.close();
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
    };
  }, [connect]);

  const subscribe = useCallback((taskId: string) => {
    subscribedRef.current.add(taskId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'subscribe', task_id: taskId }));
    }
  }, []);

  const unsubscribe = useCallback((taskId: string) => {
    subscribedRef.current.delete(taskId);
    handlersRef.current.delete(taskId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'unsubscribe', task_id: taskId }));
    }
  }, []);

  const cancel = useCallback((taskId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'cancel', task_id: taskId }));
    }
  }, []);

  const registerHandler = useCallback((taskId: string, handler: WSEventHandler) => {
    handlersRef.current.set(taskId, handler);
  }, []);

  return (
    <WebSocketContext.Provider value={{ connected, subscribe, unsubscribe, cancel, registerHandler }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used within WebSocketProvider');
  return ctx;
}
