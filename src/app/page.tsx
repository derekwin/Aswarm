"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc-react";
import { ChatMessage } from "@/components/ChatMessage";
import { AgentTracker } from "@/components/AgentTracker";
import { InputBar } from "@/components/InputBar";
import { Sidebar } from "@/components/Sidebar";

type Agent = { name: string; role: string; state: string; subtaskId: string };
type Msg = { role: string; content: string; id: number; typing?: boolean };

export default function Home() {
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [execState, setExecState] = useState<string>("idle");
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const convs = trpc.conversation.list.useQuery();
  const createConv = trpc.conversation.create.useMutation();
  const submitTask = trpc.task.submit.useMutation();
  const cancelMutation = trpc.task.cancel.useMutation();
  const utils = trpc.useUtils();
  const esRef = useRef<EventSource | null>(null);
  const execRef = useRef(execState);

  useEffect(() => { execRef.current = execState; }, [execState]);

  const connectSSE = useCallback((taskId: string) => {
    esRef.current?.close();
    const es = new EventSource(`/api/task/${taskId}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        switch (d.type) {
          case "exec_state": setExecState(d.state); break;
          case "dag":
            setExecState("streaming");
            setMessages(prev => {
              const msgs = [...prev];
              const last = msgs[msgs.length - 1];
              if (last?.role === "assistant" && last.typing) {
                msgs[msgs.length - 1] = { ...last, content: `${d.subtasks.length} agents ready`, typing: false };
              }
              return msgs;
            });
            break;
          case "agent_start":
            setAgents(prev => ({ ...prev, [d.subtask_id]: { name: d.agent_name, role: d.role, state: "running", subtaskId: d.subtask_id } }));
            break;
          case "agent_done":
            setAgents(prev => ({ ...prev, [d.subtask_id]: { ...prev[d.subtask_id], state: d.state } }));
            break;
          case "done":
            if (d.summary) setMessages(prev => [...prev, { role: "assistant", content: d.summary, id: Date.now() }]);
            setExecState("completed");
            es.close();
            break;
          case "error":
            setMessages(prev => { const msgs = [...prev]; const last = msgs[msgs.length - 1]; if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, content: `**Error**: ${d.msg}`, typing: false }; return msgs; });
            setExecState("failed");
            es.close();
            break;
        }
      } catch { /* ignore malformed */ }
    };
  }, []);

  const handleSubmit = async (query: string) => {
    let convId = activeConv;
    if (!convId) {
      const c = await createConv.mutateAsync({ title: query.slice(0, 40) });
      convId = c.id;
      setActiveConv(convId);
      utils.conversation.list.invalidate();
    }
    if (!convId) return;

    setMessages(prev => [...prev, { role: "user", content: query, id: Date.now() }]);
    setMessages(prev => [...prev, { role: "assistant", content: "Analyzing task", typing: true, id: Date.now() + 1 }]);
    setExecState("connecting");
    setAgents({});

    try {
      const { taskId } = await submitTask.mutateAsync({ query, convId });
      setCurrentTaskId(taskId);
      connectSSE(taskId);
    } catch {
      setMessages(prev => { const msgs = [...prev]; msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: "Connection lost", typing: false }; return msgs; });
      setExecState("failed");
    }
  };

  const handleStop = () => {
    esRef.current?.close();
    setExecState("cancelled");
    if (currentTaskId) {
      cancelMutation.mutate({ taskId: currentTaskId });
    }
  };

  const switchConv = async (convId: string) => {
    esRef.current?.close();
    setActiveConv(convId);
    setLoading(true);
    setMessages([]); setAgents({}); setExecState("idle");

    try {
      const conv = await utils.conversation.get.fetch({ id: convId });
      setMessages(conv.messages.map((m: { role: string; content: string; id?: number }) => ({
        role: m.role, content: m.content, id: m.id ?? Date.now()
      })));
      const task = await utils.task.get.fetch({ convId });
      if (task && task.status === "running") {
        setCurrentTaskId(task.id);
        setExecState("streaming");
        connectSSE(task.id);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const hasConvs = (convs.data || []).length > 0;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar conversations={convs.data || []} activeId={activeConv}
        onSelect={switchConv}
        onNew={async () => {
          esRef.current?.close();
          if (!hasConvs) {
            const c = await createConv.mutateAsync({ title: "New Task" });
            setActiveConv(c.id);
            utils.conversation.list.invalidate();
          } else {
            setActiveConv(null);
          }
          setMessages([]); setAgents({}); setExecState("idle");
        }} />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-zinc-800 flex items-center px-4 shrink-0 glass-heavy">
          <h1 className="font-semibold text-sm">AgentSwarm</h1>
        </header>
        <div className="flex-1 overflow-y-auto">
          {!hasConvs && !activeConv ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-zinc-500">
              <div className="w-16 h-16 flex items-center justify-center text-3xl bg-zinc-800 border border-zinc-700 rounded-xl">⚡</div>
              <h2 className="text-xl font-bold text-zinc-300">What do you want to research?</h2>
              <p className="text-base">Describe your task to get started.</p>
              <div className="flex gap-2 max-w-md w-full mt-2">
                <input
                  id="quickInput"
                  placeholder="Describe your task..."
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  onKeyDown={async e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      const q = (e.target as HTMLInputElement).value.trim();
                      if (!q) return;
                      const c = await createConv.mutateAsync({ title: q.slice(0, 40) });
                      setActiveConv(c.id); utils.conversation.list.invalidate();
                      (e.target as HTMLInputElement).value = "";
                      handleSubmit(q);
                    }
                  }}
                />
                <button onClick={async () => {
                  const el = document.getElementById("quickInput") as HTMLInputElement;
                  const q = el?.value.trim();
                  if (!q) return;
                  const c = await createConv.mutateAsync({ title: q.slice(0, 40) });
                  setActiveConv(c.id); utils.conversation.list.invalidate();
                  el.value = "";
                  handleSubmit(q);
                }} className="px-5 py-2.5 bg-accent text-white text-sm font-medium rounded-lg hover:brightness-110 transition-all">
                  Send
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-full">
              <span className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto p-4 space-y-4">
              {messages.map((m, i) => <ChatMessage key={m.id || i} {...m} />)}
              {execState !== "idle" && <AgentTracker agents={agents} execState={execState} />}
            </div>
          )}
        </div>
        {hasConvs || activeConv ? (
          <InputBar onSubmit={handleSubmit} onStop={handleStop}
            disabled={execState === "streaming" || execState === "decomposing" || execState === "connecting"} />
        ) : null}
      </main>
    </div>
  );
}
