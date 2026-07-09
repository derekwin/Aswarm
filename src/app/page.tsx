"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc-react";
import { ChatMessage } from "@/components/ChatMessage";
import { AgentTracker } from "@/components/AgentTracker";
import { InputBar } from "@/components/InputBar";
import { Sidebar } from "@/components/Sidebar";

export default function Home() {
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: string; content: string; id: number }[]>([]);
  const [agents, setAgents] = useState<Record<string, { name: string; role: string; state: string; subtaskId: string }>>({});
  const [execState, setExecState] = useState<string>("idle");
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);

  const convs = trpc.conversation.list.useQuery();
  const submitTask = trpc.task.submit.useMutation();
  const cancelTask = trpc.task.cancel.useMutation();
  const createConv = trpc.conversation.create.useMutation();
  const utils = trpc.useUtils();
  const eventSourceRef = useRef<EventSource | null>(null);

  const connectSSE = (taskId: string) => {
    eventSourceRef.current?.close();
    const es = new EventSource(`/api/task/${taskId}/stream`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      switch (data.type) {
        case "exec_state": setExecState(data.state); break;
        case "dag":
          setExecState("streaming");
          setMessages(prev => {
            const msgs = [...prev];
            const last = msgs[msgs.length - 1];
            if (last?.role === "assistant") {
              msgs[msgs.length - 1] = { ...last, content: `${data.subtasks.length} agents ready` };
            }
            return msgs;
          });
          break;
        case "agent_start":
          setAgents(prev => ({ ...prev, [data.subtask_id]: { name: data.agent_name, role: data.role, state: "running", subtaskId: data.subtask_id } }));
          break;
        case "agent_done":
          setAgents(prev => ({ ...prev, [data.subtask_id]: { ...prev[data.subtask_id], state: data.state } }));
          break;
        case "done":
          if (data.summary) setMessages(prev => [...prev, { role: "assistant", content: data.summary, id: Date.now() }]);
          setExecState("completed");
          es.close();
          break;
        case "error":
          setMessages(prev => { const msgs = [...prev]; const last = msgs[msgs.length - 1]; if (last?.role === "assistant") msgs[msgs.length - 1] = { ...last, content: `Error: ${data.msg}` }; return msgs; });
          setExecState("failed");
          es.close();
          break;
      }
    };
  };

  const handleSubmit = async (query: string) => {
    let convId = activeConv;
    if (!convId) {
      const c = await createConv.mutateAsync({ title: query.slice(0, 40) });
      convId = c.id;
      setActiveConv(convId);
      utils.conversation.list.invalidate();
    }
    if (!convId) return; // guard: must have a conversation by now
    setMessages(prev => [...prev, { role: "user", content: query, id: Date.now() }]);
    const { taskId } = await submitTask.mutateAsync({ query, convId });
    setCurrentTaskId(taskId);
    setMessages(prev => [...prev, { role: "assistant", content: "Analyzing task...", id: Date.now() + 1 }]);
    connectSSE(taskId);
  };

  const handleStop = () => {
    if (currentTaskId) { cancelTask.mutate({ taskId: currentTaskId }); setExecState("cancelled"); }
  };

  const switchConv = async (convId: string) => {
    setActiveConv(convId);
    setMessages([]); setAgents({}); setExecState("idle");
    eventSourceRef.current?.close();
    const conv = await utils.conversation.get.fetch({ id: convId });
    setMessages(conv.messages.map((m: { role: string; content: string; id: number }) => m));
    const task = await utils.task.get.fetch({ convId });
    if (task?.status === "running") { setCurrentTaskId(task.id); connectSSE(task.id); }
  };

  useEffect(() => { return () => eventSourceRef.current?.close(); }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar conversations={convs.data || []} activeId={activeConv} onSelect={switchConv}
        onNew={() => { setActiveConv(null); setMessages([]); setAgents({}); setExecState("idle"); }} />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-zinc-800 flex items-center px-4 shrink-0">
          <h1 className="font-semibold text-sm">AgentSwarm</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((m, i) => <ChatMessage key={m.id || i} {...m} />)}
          {Object.keys(agents).length > 0 && <AgentTracker agents={agents} execState={execState} />}
        </div>
        <InputBar onSubmit={handleSubmit} onStop={handleStop}
          disabled={execState === "streaming" || execState === "decomposing"} />
      </main>
    </div>
  );
}
