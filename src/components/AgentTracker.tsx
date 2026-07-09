"use client";

type Agent = { name: string; role: string; state: string; subtaskId: string; output?: string; error?: string };

function SkeletonRow() {
  return (
    <div className="flex items-center gap-2 w-full py-1.5 px-3 animate-shimmer">
      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-zinc-700" />
      <span className="h-3 rounded bg-zinc-700 flex-1" />
      <span className="h-3 w-12 rounded bg-zinc-700 shrink-0" />
    </div>
  );
}

export function AgentTracker({ agents, execState, onAgentClick }: {
  agents: Record<string, Agent>;
  execState: string;
  onAgentClick?: (agent: Agent) => void;
}) {
  const list = Object.values(agents);
  const hasAgents = list.some(a => a.name);
  const completed = list.filter(a => a.state === "completed" || a.state === "failed").length;
  const total = list.length || 3;
  const anyRunning = list.some(a => a.state === "running");
  const isStreaming = execState === "streaming" && !hasAgents;
  const isDecomposing = execState === "decomposing" || execState === "connecting";

  if (!hasAgents && !isStreaming && !isDecomposing) return null;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 overflow-hidden animate-fade-up">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/50">
        <span className={`w-1.5 h-1.5 rounded-full ${anyRunning ? "bg-accent animate-pulse" : completed === total ? "bg-green-400" : "bg-zinc-500"}`} />
        <span className="text-[11px] font-semibold text-zinc-400 flex-1">
          {anyRunning ? "Running" : execState === "completed" ? "Complete" : isDecomposing ? "Analyzing task..." : "Waiting"}
          {hasAgents && ` · ${completed}/${list.length}`}
        </span>
        {(isDecomposing || isStreaming) && <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />}
      </div>
      {(isDecomposing || isStreaming) && !hasAgents ? (
        <div><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>
      ) : (
        <div className={list.length > 1 ? "divide-y divide-zinc-700/50" : ""}>
          {list.map(a => (
            <button key={a.subtaskId} onClick={() => onAgentClick?.(a)} className="flex items-center gap-2 w-full text-left py-1.5 px-3 text-xs hover:bg-white/4 transition-colors">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.state === "running" ? "bg-accent animate-pulse" : a.state === "completed" ? "bg-green-400" : a.state === "failed" ? "bg-red-400" : "bg-zinc-600"}`} />
              <span className="text-zinc-300 truncate">{a.name}</span>
              {a.role && <span className="text-zinc-500 px-1 py-0.5 rounded bg-zinc-700/50 text-[10px] shrink-0">{a.role}</span>}
              <span className={`ml-auto text-[10px] shrink-0 ${a.state === "running" ? "text-accent" : a.state === "completed" ? "text-green-400" : a.state === "failed" ? "text-red-400" : "text-zinc-500"}`}>{a.state}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
