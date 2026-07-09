"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "@/components/ChatMessage";
import { AgentTracker } from "@/components/AgentTracker";
import { InputBar } from "@/components/InputBar";
import { Sidebar } from "@/components/Sidebar";

type Agent = { name: string; role: string; state: string; subtaskId: string };
type Msg = { role: string; content: string; id: number; typing?: boolean };

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function Home() {
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [execState, setExecState] = useState<string>("idle");
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [convs, setConvs] = useState<{ id: string; title: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const esRef = useRef<EventSource | null>(null);

  // Fetch conversations on mount
  useEffect(() => {
    fetch("/api/trpc/conversation.list?input=%7B%7D")
      .then(r => r.json())
      .then(d => { if (d?.result?.data?.json) setConvs(d.result.data.json); })
      .catch(() => {});
  }, []);

  const refreshConvs = () => {
    fetch("/api/trpc/conversation.list?input=%7B%7D")
      .then(r => r.json())
      .then(d => { if (d?.result?.data?.json) setConvs(d.result.data.json); })
      .catch(() => {});
  };

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
            setMessages(prev => { const msgs = [...prev]; const last = msgs[msgs.length - 1]; if (last?.role === "assistant" && last.typing) msgs[msgs.length - 1] = { ...last, content: `${d.subtasks.length} agents ready`, typing: false }; return msgs; });
            break;
          case "agent_start":
            setAgents(prev => ({ ...prev, [d.subtask_id]: { name: d.agent_name, role: d.role, state: "running", subtaskId: d.subtask_id } }));
            break;
          case "agent_done":
            setAgents(prev => ({ ...prev, [d.subtask_id]: { ...prev[d.subtask_id], state: d.state } }));
            break;
          case "done":
            if (d.summary) setMessages(prev => [...prev, { role: "assistant", content: d.summary, id: Date.now() }]);
            setExecState("completed"); es.close(); break;
          case "error":
            setMessages(prev => { const msgs = [...prev]; const last = msgs[msgs.length - 1]; if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, content: `**Error**: ${d.msg}`, typing: false }; return msgs; });
            setExecState("failed"); es.close(); break;
        }
      } catch { /* ignore */ }
    };
  }, []);

  const handleSubmit = async (query: string) => {
    let convId = activeConv;
    if (!convId) {
      const res = await fetch(`/api/trpc/conversation.create?input=${encodeURIComponent(JSON.stringify({ title: query.slice(0, 40) }))}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: query.slice(0, 40) }) });
      const d = await res.json();
      if (d?.result?.data?.json) {
        convId = d.result.data.json.id;
        setActiveConv(convId);
        refreshConvs();
      }
    }
    if (!convId) return;

    setMessages(prev => [...prev, { role: "user", content: query, id: Date.now() }]);
    setMessages(prev => [...prev, { role: "assistant", content: "Analyzing task", typing: true, id: Date.now() + 1 }]);
    setExecState("connecting");
    setAgents({});

    try {
      const data = JSON.stringify({ query, convId, lang: "en" });
      const res = await fetch(`/api/trpc/task.submit?input=${encodeURIComponent(data)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: data });
      const d = await res.json();
      if (d?.result?.data?.json) {
        setCurrentTaskId(d.result.data.json.taskId);
        connectSSE(d.result.data.json.taskId);
      }
    } catch {
      setMessages(prev => { const msgs = [...prev]; msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: "Connection lost", typing: false }; return msgs; });
      setExecState("failed");
    }
  };

  const handleStop = () => { esRef.current?.close(); setExecState("cancelled"); };

  const switchConv = async (convId: string) => {
    esRef.current?.close();
    setActiveConv(convId); setLoading(true);
    setMessages([]); setAgents({}); setExecState("idle");
    try {
      const res = await fetch(`/api/trpc/conversation.get?input=${encodeURIComponent(JSON.stringify({ id: convId }))}`);
      const d = await res.json();
      if (d?.result?.data?.json) {
        const c = d.result.data.json;
        setMessages((c.messages || []).map((m: { role: string; content: string; id?: number }) => ({ role: m.role, content: m.content, id: m.id ?? Date.now() })));
        const tr = await fetch(`/api/trpc/task.get?input=${encodeURIComponent(JSON.stringify({ convId }))}`);
        const td = await tr.json();
        if (td?.result?.data?.json?.status === "running") {
          setCurrentTaskId(td.result.data.json.id);
          setExecState("streaming");
          connectSSE(td.result.data.json.id);
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const hasConvs = convs.length > 0;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar conversations={convs} activeId={activeConv}
        onSelect={switchConv}
        onNew={async () => {
          esRef.current?.close();
          if (!hasConvs) {
            const res = await fetch(`/api/trpc/conversation.create?input=${encodeURIComponent(JSON.stringify({ title: "New Task" }))}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "New Task" }) });
            const d = await res.json();
            if (d?.result?.data?.json) { setActiveConv(d.result.data.json.id); refreshConvs(); }
          } else { setActiveConv(null); }
          setMessages([]); setAgents({}); setExecState("idle");
        }} />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-zinc-800 flex items-center px-4 shrink-0 glass-heavy">
          <h1 className="font-semibold text-sm">AgentSwarm</h1>
        </header>
        <div className="flex-1 overflow-y-auto">
          {!hasConvs && !activeConv ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-zinc-500 px-6">
              <div className="w-16 h-16 flex items-center justify-center text-3xl bg-zinc-800 border border-zinc-700 rounded-xl">⚡</div>
              <h2 className="text-xl font-bold text-zinc-300">What do you want to research?</h2>
              <p className="text-base">Describe your task to get started.</p>
              <div className="flex gap-2 max-w-md w-full mt-2">
                <input id="quickInput" placeholder="Describe your task..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  onKeyDown={e => { if (e.key === "Enter") { const q = (e.target as HTMLInputElement).value.trim(); if (q) handleSubmit(q); } }} />
                <button onClick={() => { const el = document.getElementById("quickInput") as HTMLInputElement; const q = el?.value.trim(); if (q) handleSubmit(q); }} className="px-5 py-2.5 bg-accent text-white text-sm font-medium rounded-lg">Send</button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-full"><span className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="max-w-3xl mx-auto p-4 space-y-4">
              {messages.map((m, i) => <ChatMessage key={m.id || i} {...m} />)}
              {execState !== "idle" && <AgentTracker agents={agents} execState={execState} />}
            </div>
          )}
        </div>
        {hasConvs || activeConv ? (
          <InputBar onSubmit={handleSubmit} onStop={handleStop} disabled={execState === "streaming" || execState === "decomposing" || execState === "connecting"} />
        ) : null}
      </main>
    </div>
  );
}
