"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChatMessage } from "@/components/ChatMessage";
import { AgentTracker } from "@/components/AgentTracker";
import { AgentDetailPanel } from "@/components/AgentDetailPanel";
import { ProgressBar } from "@/components/ProgressBar";
import { FilesPanel } from "@/components/FilesPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { InputBar } from "@/components/InputBar";
import { Sidebar } from "@/components/Sidebar";
import { useT } from "@/hooks/useT";

type Agent = { name: string; role: string; state: string; subtaskId: string; output?: string; error?: string };
type Msg = { role: string; content: string; id: number; typing?: boolean };

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function trpcQuery(path: string, input: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`);
  if (!res.ok) throw new Error(await res.text());
  const d = await res.json();
  return d.result.data.json;
}

async function trpcMutate(path: string, input: Record<string, unknown>) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) throw new Error(await res.text());
  const d = await res.json();
  return d.result.data.json;
}

export default function Home() {
  const t = useT();
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [execState, setExecState] = useState<string>("idle");
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [convs, setConvs] = useState<{ id: string; title: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clickCount, setClickCount] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const execRef = useRef(execState);
  useEffect(() => { execRef.current = execState; }, [execState]);

  // Fetch conversations
  const refreshConvs = useCallback(async () => {
    try { setConvs(await trpcQuery("conversation.list", {})); } catch { /* ignore */ }
  }, []);
  useEffect(() => { refreshConvs(); }, [refreshConvs]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // Tab notification
  useEffect(() => {
    if (execState === "completed" || execState === "failed") {
      const base = "AgentSwarm";
      const prefix = execState === "completed" ? "✓ " : "✗ ";
      let count = 0;
      const interval = setInterval(() => {
        document.title = count % 2 === 0 ? prefix + base : base;
        if (++count > 6) { document.title = base; clearInterval(interval); }
      }, 1000);
      return () => { document.title = base; clearInterval(interval); };
    }
  }, [execState]);

  // SSE with auto-reconnect
  const connectSSE = useCallback((taskId: string) => {
    esRef.current?.close();
    clearTimeout(reconnectTimer.current);

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
            setAgents(prev => ({ ...prev, [d.subtask_id]: { ...prev[d.subtask_id], state: d.state, output: d.output, error: d.error } }));
            break;
          case "progress":
            setProgress({ completed: d.completed, total: d.total });
            break;
          case "done":
            if (d.summary) setMessages(prev => [...prev, { role: "assistant", content: d.summary, id: Date.now() }]);
            setExecState("completed"); es.close(); showToast("✓ " + t("complete"));
            break;
          case "error":
            setMessages(prev => { const msgs = [...prev]; const last = msgs[msgs.length - 1]; if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, content: `**Error**: ${d.msg}`, typing: false }; return msgs; });
            setExecState("failed"); es.close(); showToast("✗ " + t("failed"));
            break;
        }
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      es.close();
      const st = execRef.current;
      if (st === "streaming" || st === "decomposing" || st === "connecting") {
        reconnectTimer.current = setTimeout(() => connectSSE(taskId), 2000);
      }
    };
  }, [t]);

  useEffect(() => { return () => { esRef.current?.close(); clearTimeout(reconnectTimer.current); }; }, []);

  const handleSubmit = async (query: string) => {
    let convId = activeConv;
    if (!convId) {
      try {
        const c = await trpcMutate("conversation.create", { title: query.slice(0, 40) });
        convId = c.id; setActiveConv(convId); refreshConvs();
      } catch { return; }
    }
    if (!convId) return;

    setMessages(prev => [...prev, { role: "user", content: query, id: Date.now() }]);
    setMessages(prev => [...prev, { role: "assistant", content: t("decomposing"), typing: true, id: Date.now() + 1 }]);
    setExecState("connecting"); setAgents({}); setProgress(null); setDetailAgent(null);

    try {
      const r = await trpcMutate("task.submit", { query, convId, lang: localStorage.getItem("lang") || "en" });
      setCurrentTaskId(r.taskId);
      connectSSE(r.taskId);
    } catch {
      setMessages(prev => { const msgs = [...prev]; msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: t("connectionLost"), typing: false }; return msgs; });
      setExecState("failed");
    }
  };

  const handleStop = () => {
    esRef.current?.close();
    setExecState("cancelled");
    if (currentTaskId) trpcMutate("task.cancel", { taskId: currentTaskId }).catch(() => {});
  };

  const switchConv = async (convId: string) => {
    esRef.current?.close(); clearTimeout(reconnectTimer.current);
    setActiveConv(convId); setLoading(true);
    setMessages([]); setAgents({}); setExecState("idle"); setProgress(null); setDetailAgent(null);
    try {
      const c = await trpcQuery("conversation.get", { id: convId });
      setMessages((c.messages || []).map((m: { role: string; content: string; id?: number }) => ({ role: m.role, content: m.content, id: m.id ?? Date.now() })));
      const t = await trpcQuery("task.get", { convId });
      if (t?.status === "running") { setCurrentTaskId(t.id); setExecState("streaming"); connectSSE(t.id); }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleEdit = (text: string) => { if (text) handleSubmit(text); };
  const hasConvs = convs.length > 0;
  const completedAgents = Object.values(agents).filter(a => a.state === "completed" || a.state === "failed").length;
  const totalAgents = Math.max(Object.keys(agents).length, progress?.total || 0);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      {/* Sidebar: hidden on mobile, visible on lg+ */}
      <div className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 fixed lg:static top-0 bottom-0 left-0 z-50 transition-transform duration-200`}>
        <Sidebar conversations={convs} activeId={activeConv} onSelect={(id) => { switchConv(id); setSidebarOpen(false); }}
          onNew={async () => {
          esRef.current?.close();
          if (!hasConvs) {
            try { const c = await trpcMutate("conversation.create", { title: "New Task" }); setActiveConv(c.id); refreshConvs(); } catch { /* ignore */ }
          } else { setActiveConv(null); }
          setMessages([]); setAgents({}); setExecState("idle"); setProgress(null);
        }} />
      </div>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-zinc-800 flex items-center px-4 shrink-0 glass-heavy">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden mr-2 text-zinc-400 hover:text-zinc-200 p-1">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <h1 className="font-semibold text-sm">AgentSwarm</h1>
          <button onClick={() => setClickCount(c => c + 1)} className="ml-2 px-2 py-1 bg-zinc-700 rounded text-xs text-zinc-300">
            Test {clickCount}
          </button>
          <div className="ml-auto flex items-center gap-1">
            {activeConv && Object.keys(agents).length > 0 && (
              <button onClick={() => setShowFiles(!showFiles)} className={`px-2 py-1 text-xs rounded ${showFiles ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}>📂</button>
            )}
            <button onClick={() => setShowSettings(!showSettings)} className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300">⚙</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {!hasConvs && !activeConv ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-zinc-500 px-6">
              <div className="w-16 h-16 flex items-center justify-center text-3xl bg-zinc-800 border border-zinc-700 rounded-xl">⚡</div>
              <h2 className="text-xl font-bold text-zinc-300">{t("emptyTitle")}</h2>
              <p className="text-base">{t("emptyDesc")}</p>
              <div className="flex gap-2 max-w-md w-full mt-2">
                <input id="quickInput" placeholder={t("taskPlaceholder")} className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  onKeyDown={e => { if (e.key === "Enter") { const q = (e.target as HTMLInputElement).value.trim(); if (q) handleSubmit(q); } }} />
                <button onClick={() => { const el = document.getElementById("quickInput") as HTMLInputElement; const q = el?.value.trim(); if (q) handleSubmit(q); }} className="px-5 py-2.5 bg-accent text-white text-sm font-medium rounded-lg">{t("send")}</button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-full"><span className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="max-w-3xl mx-auto p-4 space-y-4">
              {messages.map((m, i) => <ChatMessage key={m.id || i} {...m} onEdit={handleEdit} />)}
              {progress && totalAgents > 0 && <ProgressBar completed={completedAgents} total={totalAgents} />}
              {execState !== "idle" && <AgentTracker agents={agents} execState={execState} onAgentClick={setDetailAgent} />}
              {detailAgent && currentTaskId && <AgentDetailPanel agent={detailAgent} taskId={currentTaskId} onClose={() => setDetailAgent(null)} />}
              {showFiles && activeConv && <FilesPanel convId={activeConv} onClose={() => setShowFiles(false)} />}
            </div>
          )}
        </div>

        {hasConvs || activeConv ? (
          <InputBar onSubmit={handleSubmit} onStop={handleStop}
            disabled={execState === "streaming" || execState === "decomposing" || execState === "connecting"} />
        ) : null}
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {toast && <div className="fixed bottom-6 right-6 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-200 shadow-lg animate-fade-up z-50">{toast}</div>}
    </div>
  );
}
