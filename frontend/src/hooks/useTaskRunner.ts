import { useCallback, useRef, useEffect } from 'react';
import { useConv } from '@/context/ConvContext';
import { useUI } from '@/context/UIContext';
import { useT } from '@/hooks/useT';
import { useWebSocket } from '@/context/WebSocketContext';
import { api } from '@/api';
import type { WSEvent, ErrorCode } from '@/types';
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
  const execStateRef = useRef(conv.execState);
  const taskIdRef = useRef<string | null>(null);
  const convIdRef = useRef<string | null>(null);
  const debounceTimer = useRef(0);
  const startTimeRef = useRef<Record<string, number>>({});

  const handleWSEvent = useCallback((raw: Record<string, unknown>) => {
    const d = raw as WSEvent;
    switch (d.type) {
      case 'catchup_done':
        break;
      case 'status':
        convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: d.msg, typing: false } });
        break;
      case 'exec_state':
        convDispatch({ type: 'SET_EXEC_STATE', payload: d.state });
        if (d.state === 'decomposing') {
          convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: t('decomposing'), typing: true } });
        }
        break;
      case 'dag':
        convDispatch({ type: 'SET_DAG', payload: { dag: { intent: d.intent, subtasks: d.subtasks, parallel_groups: d.parallel_groups }, totalAgents: d.subtasks.length } });
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'streaming' });
        convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: `${d.subtasks.length} agents ready · ${d.intent || 'executing...'}`, typing: false } });
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
          type: 'APPEND_MSG',
          payload: {
            role: 'assistant',
            content: `**⚠ Approval Required**\n\nAgent **${d.agent_name}** wants to:\n> ${d.action}\n\n**Reasoning:** ${d.reasoning}\n\n**Risk level:** \`${d.risk_level}\``,
            typing: false,
            approval: {
              subtaskId: d.subtask_id,
              agentName: d.agent_name,
              action: d.action,
              reasoning: d.reasoning,
              riskLevel: d.risk_level,
            },
          },
        });
        break;
      case 'done':
        uiDispatch({ type: 'SET_CONNECTED', payload: false });
        if (d.summary) convDispatch({ type: 'APPEND_MSG', payload: { role: 'assistant', content: d.summary } });
        convDispatch({ type: 'SET_EXEC_STATE', payload: 'completed' });
        uiDispatch({ type: 'ADD_TOAST', payload: `✓ ${t('complete')}` });
        break;
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

  const { subscribe, cancel: wsCancel, registerHandler } = useWebSocket();

  const { runMockTask } = useMockRunner((event) => handleWSEvent(event as Record<string, unknown>));

  const runTask = useCallback(async (convId: string, query: string) => {
    // Append user message and start fresh assistant context
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
      taskIdRef.current = task_id;
      uiDispatch({ type: 'SET_CONNECTED', payload: true });
      // Update sidebar title immediately from query
      try {
        const title = query.slice(0, 40);
        localStorage.setItem(`conv_title:${convId}`, title);
      } catch { /* ignore */ }
      registerHandler(task_id, handleWSEvent);
      subscribe(task_id, convId);
    } catch {
      uiDispatch({ type: 'SET_CONNECTED', payload: false });
      convDispatch({ type: 'SET_EXEC_STATE', payload: 'failed' });
      convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: t('loadError'), typing: false } });
      uiDispatch({ type: 'ADD_TOAST', payload: t('startTaskFailed') });
    }
  }, [convDispatch, uiDispatch, subscribe, registerHandler, handleWSEvent, t]);

  const reconnect = useCallback((taskId: string, agentResults: { subtask_id: string; agent_name: string; state: string; output?: string; error?: string; retry_count: number }[]) => {
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
    registerHandler(taskId, handleWSEvent);
    subscribe(taskId, convIdRef.current || '');
  }, [convDispatch, uiDispatch, subscribe, registerHandler, handleWSEvent]);

  const cancelTask = useCallback(async (silent = false) => {
    uiDispatch({ type: 'SET_CONNECTED', payload: false });
    if (!silent) {
      const tid = taskIdRef.current;
      if (tid) {
        wsCancel(tid);
      }
      convDispatch({ type: 'SET_EXEC_STATE', payload: 'cancelled' });
      convDispatch({ type: 'UPDATE_LAST_MSG', payload: { content: t('cancelled'), typing: false } });
    }
  }, [wsCancel, convDispatch, uiDispatch, t]);

  const cleanupRefs = useCallback(() => {
    convIdRef.current = null;
    taskIdRef.current = null;
  }, []);

  return { runTask, reconnect, cancelTask, cleanupRefs, handleWSEvent };
}
