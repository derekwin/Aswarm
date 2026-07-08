import { useCallback, useRef, useEffect } from 'react';
import { useConv } from '@/context/ConvContext';
import { useUI } from '@/context/UIContext';
import { useT } from '@/hooks/useT';
import { api } from '@/api';
import type { SSEEvent, ErrorCode } from '@/types';
import { ERROR_SUGGESTIONS } from '@/types';
import { useMockRunner } from '@/hooks/useMockRunner';

const TAB_ID = crypto.randomUUID?.() ?? `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;

function shouldWriteCache(convId: string): boolean {
  if (!navigator.onLine) return false;
  try {
    const raw = localStorage.getItem(`conv:${convId}`);
    if (!raw) return true;
    const entry = JSON.parse(raw);
    return entry.tabId === TAB_ID;
  } catch {
    return true;
  }
}

export function useTaskRunner() {
  const { state: conv, dispatch: convDispatch } = useConv();
  const { state: ui, dispatch: uiDispatch } = useUI();
  const t = useT();
  const eventSourceRef = useRef<EventSource | null>(null);
  const execStateRef = useRef(conv.execState);
  const connectSSERef = useRef<((taskId: string, fromEventId?: number) => void) | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const convIdRef = useRef<string | null>(null);
  const lastEventIdRef = useRef<number>(0);
  const debounceTimer = useRef(0);
  const startTimeRef = useRef<Record<string, number>>({});
  const reconnectAttemptRef = useRef(0);
  const pollTimerRef = useRef(0);
  const pollActiveRef = useRef(false);

  const handleSSEEvent = useCallback((d: SSEEvent, es: EventSource) => {
    switch (d.type) {
      case 'status':
        // Agent cards already show progress — skip redundant status text in chat
        break;
      case 'exec_state':
        convDispatch({ type: 'SET_EXEC_STATE', payload: d.state });
        if (d.state === 'decomposing') {
          convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: 'Decomposing task...', typing: true } });
        } else if (d.state === 'streaming') {
          convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: 'Executing agents...', typing: false } });
        }
        break;
      case 'dag':
        convDispatch({ type: 'SET_DAG', payload: { dag: { intent: d.intent, subtasks: d.subtasks, parallel_groups: d.parallel_groups }, totalAgents: d.subtasks.length } });
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'streaming' });
        convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: d.subtasks.length + ' agents ready: ' + (d.intent || 'executing...'), typing: false } });
        break;
      case 'agent_start':
        startTimeRef.current[d.subtask_id] = Date.now();
        convDispatch({ type: 'UPDATE_AGENT', payload: { id: d.subtask_id, data: { name: d.agent_name, role: d.role, state: 'running', retryCount: 0, subtaskId: d.subtask_id } } });
        break;
      case 'agent_done':
        delete startTimeRef.current[d.subtask_id];
        convDispatch({ type: 'UPDATE_AGENT', payload: { id: d.subtask_id, data: { state: d.state as 'completed' | 'failed', output: d.output, error: d.error, retryCount: d.retry_count, subtaskId: d.subtask_id } } });
        if (d.state === 'completed' || d.state === 'failed') {
          convDispatch({ type: 'INCREMENT_COMPLETED', payload: { subtaskId: d.subtask_id } });
        }
        break;
      case 'tool_call':
        convDispatch({ type: 'APPEND_ACTIVITY', payload: { agent: d.agent_name, tool: d.tool, args: d.args, time: Date.now() } });
        break;
      case 'progress':
        convDispatch({ type: 'SET_PROGRESS', payload: { completed: d.completed, total: d.total } });
        break;
      case 'approval_request':
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'waiting_approval' });
        convDispatch({
          type: 'UPDATE_LAST_MSG',
          payload: {
            content: `**⚠ Approval Required**\n\nAgent **${d.agent_name}** wants to:\n> ${d.action}\n\nReasoning: ${d.reasoning}\n\nRisk level: \`${d.risk_level}\`\n\n_Click Approve or Reject below — task will resume with your decision._`,
            typing: false,
          },
        });
        break;
      case 'done': {
        uiDispatch({ type: 'SET_CONNECTED', payload: false });
        if (d.summary) convDispatch({ type: 'APPEND_MSG', payload: { role: 'assistant', content: d.summary } });
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'completed' });
        es?.close?.();
        uiDispatch({ type: 'ADD_TOAST', payload: `✓ ${t('complete')}` });
        break;
      }
      case 'error': {
        uiDispatch({ type: 'SET_CONNECTED', payload: false });
        convDispatch({ type: 'SET_ERROR', payload: { message: d.msg, code: d.code } });
        const suggestion = d.code ? ERROR_SUGGESTIONS[d.code as ErrorCode] || '' : '';
        convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: `**Error**: ${d.msg}${suggestion ? '\n\n' + suggestion : ''}`, typing: false } });
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'failed' });
        break;
      }
    }
  }, [convDispatch, uiDispatch, t]);
  const saveStateCache = useCallback(() => {
    if (!convIdRef.current) return;
    if (!shouldWriteCache(convIdRef.current)) return;
    clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(`conv:${convIdRef.current}`, JSON.stringify({
          messages: conv.messages, agents: conv.agents, dag: conv.dag,
          activity: conv.activity, totalAgents: conv.totalAgents,
          completedAgents: conv.completedAgents, execState: conv.execState,
          error: conv.error, errorCode: conv.errorCode,
          progress: conv.progress, taskId: conv.taskId,
          _completedSet: conv._completedSet,
          _lastEventId: conv._lastEventId,
          ts: Date.now(),
          tabId: TAB_ID,
        }));
      } catch { /* quota exceeded */ }
    }, 300);
  }, [conv.messages, conv.agents, conv.dag, conv.activity, conv.execState, conv.progress, conv.taskId, conv._lastEventId]);

  // Auto-save state to localStorage on every change
  useEffect(() => { saveStateCache(); }, [saveStateCache]);

  useEffect(() => { execStateRef.current = conv.execState; }, [conv.execState]);

  // Timeout fallback: if stuck in decomposing/connecting too long, mark failed
  useEffect(() => {
    if (conv.execState !== 'connecting' && conv.execState !== 'decomposing') return;
    const timeout = setTimeout(() => {
      if (execStateRef.current === conv.execState) { // still same state after timeout
        convDispatch({ type: 'SET_ERROR', payload: { message: 'Task timed out during ' + conv.execState, code: 'TIMEOUT' } });
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'failed' });
      }
    }, 60000); // 60s timeout
    return () => clearTimeout(timeout);
  }, [conv.execState, convDispatch]);

  // Tab notification on task complete/fail
  useEffect(() => {
    if (conv.execState === 'completed' || conv.execState === 'failed') {
      const base = 'AgentSwarm';
      const prefix = conv.execState === 'completed' ? '✓ ' : '✗ ';
      let count = 0;
      const interval = setInterval(() => {
        document.title = count % 2 === 0 ? prefix + base : base;
        count++;
        if (count > 6) { document.title = base; clearInterval(interval); }
      }, 1000);
      return () => { document.title = base; clearInterval(interval); };
    }
  }, [conv.execState]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      pollActiveRef.current = false;
      clearTimeout(pollTimerRef.current);
    };
  }, []);

  const connectSSE = useCallback((taskId: string, fromEventId = 0) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.onerror = null;
      eventSourceRef.current.close();
    }
    taskIdRef.current = taskId;
    const url = fromEventId > 0 ? `/stream/${taskId}?last_event_id=${fromEventId}` : `/stream/${taskId}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (e: MessageEvent) => {
      try {
        const d: SSEEvent = JSON.parse(e.data);
        if (e.lastEventId) {
          lastEventIdRef.current = parseInt(e.lastEventId, 10);
          convDispatch({ type: 'SET_LAST_EVENT_ID', payload: lastEventIdRef.current });
        }
        // Reset backoff on successful message and stop polling
        reconnectAttemptRef.current = 0;
        if (pollActiveRef.current) {
          pollActiveRef.current = false;
          clearTimeout(pollTimerRef.current);
        }
        handleSSEEvent(d, es);
      } catch { /* malformed SSE data, ignore */ }
    };

    es.onerror = () => {
      es.close();
      const isRunning = execStateRef.current === 'streaming' || execStateRef.current === 'reconnecting';
      if (isRunning) {
        // Exponential backoff reconnection with lastEventId for gap recovery
        reconnectAttemptRef.current += 1;
        const delay = Math.min(1000 * (2 ** (reconnectAttemptRef.current - 1)), 30000);
        setTimeout(() => {
          if (execStateRef.current === 'streaming' || execStateRef.current === 'reconnecting') {
            connectSSERef.current?.(taskId, lastEventIdRef.current);
          }
        }, delay);

        // Fallback: poll via REST — only start if not already polling
        if (!pollActiveRef.current) {
          pollActiveRef.current = true;
          const poll = async () => {
            if (!pollActiveRef.current || !convIdRef.current) return;
            try {
              const data = await api.getRunningTask(convIdRef.current);
              if (!data.task || data.task.id !== taskId) { pollActiveRef.current = false; return; }
              if (data.task.status === 'completed' || data.task.status === 'failed' || data.task.status === 'cancelled') {
                pollActiveRef.current = false;
                convDispatch({ type: 'SET_EXEC_STATE', payload: data.task.status === 'completed' ? 'completed' : 'failed' });
                return;
              }
              for (const r of (data.agent_results || [])) {
                convDispatch({ type: 'UPDATE_AGENT', payload: { id: r.subtask_id, data: { state: r.state as 'pending' | 'running' | 'completed' | 'failed', output: r.output, error: r.error } } });
              }
            } catch { pollActiveRef.current = false; }
            if (pollActiveRef.current) pollTimerRef.current = window.setTimeout(poll, 2000);
          };
          pollTimerRef.current = window.setTimeout(poll, 2000);
          uiDispatch({ type: 'ADD_TOAST', payload: '⚠ Polling for updates...' });
        }
      } else {
        uiDispatch({ type: 'SET_CONNECTED', payload: false });
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'failed' });
        uiDispatch({ type: 'ADD_TOAST', payload: `⚠ ${t('connectionLost')}` });
      }
    };
  }, [convDispatch, uiDispatch, handleSSEEvent, t]);

  useEffect(() => { connectSSERef.current = connectSSE; }, [connectSSE]);

  const { runMockTask } = useMockRunner((event) => handleSSEEvent(event as SSEEvent, eventSourceRef.current!));

  const runTask = useCallback(async (convId: string, query: string) => {
    convDispatch({ type: 'APPEND_MSG', payload: { role: 'user', content: query } });
    convDispatch({ type: 'APPEND_MSG', payload: { role: 'assistant', content: t('decomposing'), typing: true } });
    convDispatch({ type: 'SET_EXEC_STATE', payload: 'connecting' });
    convIdRef.current = convId;

    if (import.meta.env.VITE_MOCK) {
      try {
        uiDispatch({ type: 'SET_CONNECTED', payload: true });
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'streaming' });
        await runMockTask(query);
      } catch {
        uiDispatch({ type: 'SET_CONNECTED', payload: false });
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'failed' });
      }
      return;
    }

    try {
      const { task_id } = await api.runTask(query, convId, ui.lang);
      convDispatch({ type: 'SET_TASK_ID', payload: task_id });
      uiDispatch({ type: 'SET_CONNECTED', payload: true });
      connectSSE(task_id);
    } catch {
      uiDispatch({ type: 'SET_CONNECTED', payload: false });
      convDispatch({ type: 'SET_EXEC_STATE', payload: 'failed' });
      convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: t('loadError'), typing: false } });
      uiDispatch({ type: 'ADD_TOAST', payload: t('startTaskFailed') });
    }
  }, [convDispatch, uiDispatch, connectSSE, t]);

  const reconnect = useCallback((taskId: string, agentResults: { subtask_id: string; agent_name: string; state: string; output?: string; error?: string; retry_count: number }[]) => {
    if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) return;
    uiDispatch({ type: 'SET_CONNECTED', payload: true });

    for (const r of agentResults) {
      convDispatch({
        type: 'UPDATE_AGENT',
        payload: {
          id: r.subtask_id,
          data: {
            name: r.agent_name,
            role: '',
            state: r.state as 'completed' | 'failed',
            output: r.output,
            error: r.error,
            retryCount: r.retry_count,
          },
        },
      });
      if (r.state === 'completed' || r.state === 'failed') {
        convDispatch({ type: 'INCREMENT_COMPLETED', payload: { subtaskId: r.subtask_id } });
      }
    }

    convDispatch({ type: 'SET_EXEC_STATE', payload: 'reconnecting' });
    connectSSE(taskId);
  }, [convDispatch, uiDispatch, connectSSE]);

  const cancelTask = useCallback(async (silent = false) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.onerror = null;
      eventSourceRef.current.close();
    }
    eventSourceRef.current = null;
    uiDispatch({ type: 'SET_CONNECTED', payload: false });
    if (!silent) {
      const tid = taskIdRef.current;
      if (tid) {
        try { await api.cancelTask(tid); } catch { /* best effort */ }
      }
      convDispatch({ type: 'SET_EXEC_STATE', payload: 'cancelled' });
      convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: t('cancelled'), typing: false } });
    }
  }, [convDispatch, uiDispatch, t]);

  const cleanupRefs = useCallback(() => {
    convIdRef.current = null;
    taskIdRef.current = null;
  }, []);

  return { runTask, reconnect, cancelTask, connectSSE, cleanupRefs };
}
