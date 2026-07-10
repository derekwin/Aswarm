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

// ── API helpers ──

async function get(path: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Types ──

type Agent = {
  name: string;
  role: string;
  state: string;
  subtaskId: string;
  output?: string;
  error?: string;
};

type Message = {
  role: string;
  content: string;
  id: number;
  typing?: boolean;
};

// ── Page ──

export default function Home() {
  const t = useT();

  // State
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [execState, setExecState] = useState("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [convs, setConvs] = useState<{ id: string; title: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [workerOnline, setWorkerOnline] = useState(true);

  // Refs
  const eventSource = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const execStateRef = useRef(execState);
  useEffect(() => { execStateRef.current = execState; }, [execState]);

  // ── Data fetching ──

  const refreshConvs = useCallback(async () => {
    try {
      const data = await get("/api/conversations");
      setConvs(data);
      // Auto-restore last active conversation
      if (data.length > 0 && !activeConv) {
        const lastId = localStorage.getItem("lastConvId");
        if (lastId && data.find((c: { id: string }) => c.id === lastId)) {
          switchConversation(lastId);
        }
      }
    } catch (e) { console.error("Failed to load conversations:", e); }
  }, []);
  useEffect(() => { refreshConvs(); }, [refreshConvs]);

  // Health check: ping Python worker every 30s
  useEffect(() => {
    const check = () => {
      fetch(`http://${window.location.hostname}:8001/health`)
        .then(r => setWorkerOnline(r.ok))
        .catch(() => setWorkerOnline(false));
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  // ── Toast ──

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Tab notification ──

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

  // ── SSE connection ──

  const connectSSE = useCallback((id: string) => {
    eventSource.current?.close();
    clearTimeout(reconnectTimer.current);

    const workerUrl = `http://${window.location.hostname}:8001/events/${id}`;
    const es = new EventSource(workerUrl);
    eventSource.current = es;

    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        switch (d.type) {
          case "exec_state":
            setExecState(d.state);
            break;
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
            setAgents(prev => ({ ...prev, [d.subtask_id]: { ...prev[d.subtask_id], state: d.state, output: d.output, error: d.error } }));
            break;
          case "progress":
            setProgress({ completed: d.completed, total: d.total });
            break;
          case "done":
            if (d.summary) setMessages(prev => [...prev, { role: "assistant", content: d.summary, id: Date.now() }]);
            setExecState("completed");
            es.close();
            showToast("✓ " + t("complete"));
            break;
          case "error":
            setMessages(prev => {
              const msgs = [...prev];
              const last = msgs[msgs.length - 1];
              if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, content: `**Error**: ${d.msg}`, typing: false };
              return msgs;
            });
            setExecState("failed");
            es.close();
            showToast("✗ " + t("failed"));
            break;
        }
      } catch { /* malformed event */ }
    };

    es.onerror = () => {
      es.close();
      const state = execStateRef.current;
      if (state === "streaming" || state === "decomposing" || state === "connecting") {
        reconnectTimer.current = setTimeout(() => connectSSE(id), 2000);
      }
    };
  }, [t]);

  useEffect(() => {
    return () => { eventSource.current?.close(); clearTimeout(reconnectTimer.current); };
  }, []);

  // Auto-scroll on new messages (only if near bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Keyboard shortcut: Ctrl+K / Cmd+K to focus input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const el = document.getElementById("quickInput") || document.querySelector("main input[type='text'], main textarea");
        if (el instanceof HTMLElement) el.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Actions ──

  const handleSubmit = async (query: string) => {
    let convId = activeConv;
    if (!convId) {
      try {
        const conv = await post("/api/conversations", { title: query.slice(0, 40) });
        convId = conv.id;
        setActiveConv(convId);
        refreshConvs();
      } catch (e) { console.error("Failed to create conversation:", e); return; }
    }
    if (!convId) return;

    setMessages(prev => [...prev, { role: "user", content: query, id: Date.now() }]);
    setMessages(prev => [...prev, { role: "assistant", content: t("decomposing"), typing: true, id: Date.now() + 1 }]);
    setExecState("connecting");
    setAgents({});
    setProgress(null);
    setDetailAgent(null);

    try {
      const result = await post("/api/tasks", { query, convId, lang: localStorage.getItem("lang") || "en" });
      setTaskId(result.taskId);
      connectSSE(result.taskId);
    } catch (e) {
      console.error("Failed to start task:", e);
      setMessages(prev => {
        const msgs = [...prev];
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: t("connectionLost"), typing: false };
        return msgs;
      });
      setExecState("failed");
    }
  };

  const handleStop = () => {
    eventSource.current?.close();
    setExecState("cancelled");
    if (taskId) post(`/api/tasks/${taskId}/cancel`).catch(() => {});
  };

  const switchConversation = async (id: string) => {
    eventSource.current?.close();
    clearTimeout(reconnectTimer.current);
    setActiveConv(id);
    setLoading(true);
    localStorage.setItem("lastConvId", id);
    setMessages([]);
    setAgents({});
    setExecState("idle");
    setProgress(null);
    setDetailAgent(null);

    try {
      const conv = await get(`/api/conversations/${id}`);
      document.title = (conv.title || "AgentSwarm") + " — AgentSwarm";
      setMessages((conv.messages || []).map((m: { role: string; content: string; id?: number }) => ({
        role: m.role, content: m.content, id: m.id ?? Date.now(),
      })));
      if (conv.task?.status === "running") {
        setTaskId(conv.task.id);
        setExecState("streaming");
        connectSSE(conv.task.id);
      }
    } catch { /* ignore */ }
    setLoading(false);
    // Focus input after switching
    setTimeout(() => {
      const el = document.querySelector("main input[type='text'], main textarea") as HTMLElement | null;
      el?.focus();
    }, 100);
  };

  const handleEdit = (text: string) => {
    if (text) handleSubmit(text);
  };

  const handleDeleteConv = async (id: string) => {
    if (!confirm("Delete this conversation?")) return;
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (id === activeConv) { setActiveConv(null); setMessages([]); setAgents({}); setExecState("idle"); }
      refreshConvs();
    } catch { /* ignore */ }
  };

  // ── Derived values ──

  const hasConversations = convs.length > 0;
  const completedAgents = Object.values(agents).filter(a => a.state === "completed" || a.state === "failed").length;
  const totalAgents = Math.max(Object.keys(agents).length, progress?.total || 0);
  const isExecuting = execState === "streaming" || execState === "decomposing" || execState === "connecting";

  // ── Quick start examples ──

  const examples = [
    { icon: "🔬", title: "Market Research", query: "Research the 2025 domestic AI chip market including market share, major vendors, product lines, and policy environment" },
    { icon: "💻", title: "Code Generation", query: "Write a Python scraper to crawl Douban Movie Top 250, extract ranking, title, rating, review count, and save as CSV" },
    { icon: "📊", title: "Tech Comparison", query: "Compare React vs Vue ecosystems, performance, community activity, and trends in 2025" },
  ];

  // ── Render ──

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <div className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 fixed lg:static top-0 bottom-0 left-0 z-50 transition-transform duration-200`}>
        <Sidebar
          conversations={convs}
          activeId={activeConv}
          loading={convs.length === 0 && !activeConv}
          onSelect={(id) => { switchConversation(id); setSidebarOpen(false); }}
          onDelete={handleDeleteConv}
          onNew={async () => {
            eventSource.current?.close();
            if (!hasConversations) {
              try { const c = await post("/api/conversations", { title: "New Task" }); setActiveConv(c.id); refreshConvs(); } catch { /* ignore */ }
            } else {
              setActiveConv(null);
              document.title = "AgentSwarm";
            }
            setMessages([]); setAgents({}); setExecState("idle"); setProgress(null);
          }}
        />
      </div>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-zinc-800 flex items-center px-4 shrink-0 glass-heavy">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden mr-2 text-zinc-400 hover:text-zinc-200 p-1">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <h1 className="font-semibold text-sm">AgentSwarm</h1>
          <span className={`w-1.5 h-1.5 rounded-full ml-2 ${workerOnline ? "bg-green-400" : "bg-red-400 animate-pulse"}`} title={workerOnline ? "Worker online" : "Worker offline"} />
          <div className="ml-auto flex items-center gap-1">
            {activeConv && Object.keys(agents).length > 0 && (
              <button onClick={() => setShowFiles(!showFiles)} className={`px-2 py-1 text-xs rounded ${showFiles ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}>📂</button>
            )}
            <button onClick={() => setShowSettings(!showSettings)} className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300">⚙</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Empty state */}
          {!hasConversations && !activeConv ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-zinc-500 px-6">
              <div className="w-16 h-16 flex items-center justify-center text-3xl bg-zinc-800 border border-zinc-700 rounded-xl">⚡</div>
              <h2 className="text-xl font-bold text-zinc-300">{t("emptyTitle")}</h2>
              <p className="text-base">{t("emptyDesc")}</p>

              <div className="flex flex-wrap gap-3 justify-center max-w-2xl mt-1">
                {examples.map(ex => (
                  <button key={ex.title} onClick={() => handleSubmit(ex.query)}
                    className="flex flex-col items-center gap-2 p-4 bg-zinc-800 border border-zinc-700 rounded-xl w-44 hover:border-accent hover:scale-[1.02] transition-all text-left group">
                    <span className="text-2xl">{ex.icon}</span>
                    <span className="text-xs font-semibold text-zinc-300 group-hover:text-accent">{ex.title}</span>
                    <span className="text-[10px] text-zinc-500 line-clamp-2">{ex.query.slice(0, 60)}...</span>
                  </button>
                ))}
              </div>

              <div className="flex gap-2 max-w-md w-full mt-2">
                <input id="quickInput" placeholder={t("taskPlaceholder")}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  onKeyDown={e => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) handleSubmit(v); } }} />
                <button onClick={() => { const el = document.getElementById("quickInput") as HTMLInputElement; const v = el?.value.trim(); if (v) handleSubmit(v); }}
                  className="px-5 py-2.5 bg-accent text-white text-sm font-medium rounded-lg">{t("send")}</button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center h-full">
              <span className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto p-4 space-y-4" ref={scrollRef}>
              {messages.map((m, i) => {
                const isFirstAssistant = m.role === "assistant" && messages.findIndex(x => x.role === "assistant") === i;
                return (
                  <ChatMessage key={m.id || i} {...m} onEdit={handleEdit}>
                    {isFirstAssistant && execState !== "idle" && (
                      <>
                        {progress && totalAgents > 0 && <ProgressBar completed={completedAgents} total={totalAgents} />}
                        <AgentTracker agents={agents} execState={execState} onAgentClick={setDetailAgent} />
                      </>
                    )}
                  </ChatMessage>
                );
              })}
              {detailAgent && taskId && <AgentDetailPanel agent={detailAgent} taskId={taskId} onClose={() => setDetailAgent(null)} />}
              {showFiles && activeConv && <FilesPanel convId={activeConv} onClose={() => setShowFiles(false)} />}
            </div>
          )}
        </div>

        {hasConversations || activeConv ? (
          <InputBar onSubmit={handleSubmit} onStop={handleStop} disabled={isExecuting} />
        ) : null}
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-zinc-200 shadow-lg animate-fade-up z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
