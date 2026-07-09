type Agent = { name: string; role: string; state: string; subtaskId: string };

export function AgentTracker({ agents, execState }: {
  agents: Record<string, Agent>;
  execState: string;
}) {
  const list = Object.values(agents);
  const completed = list.filter(a => a.state === "completed" || a.state === "failed").length;
  const anyRunning = list.some(a => a.state === "running");

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${anyRunning ? "bg-blue-400 animate-pulse" : "bg-green-400"}`} />
        <span className="text-xs font-medium text-zinc-400">
          {anyRunning ? "Running" : execState === "completed" ? "Complete" : "Waiting"}
          {" · "}{completed}/{list.length}
        </span>
      </div>
      <div className="space-y-1">
        {list.map(a => (
          <div key={a.subtaskId} className="flex items-center gap-2 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${
              a.state === "running" ? "bg-blue-400 animate-pulse" :
              a.state === "completed" ? "bg-green-400" :
              a.state === "failed" ? "bg-red-400" : "bg-zinc-600"
            }`} />
            <span className="text-zinc-300 truncate">{a.name}</span>
            {a.role && <span className="text-zinc-500 px-1 py-0.5 rounded bg-zinc-700 text-[10px]">{a.role}</span>}
            <span className={`ml-auto text-[10px] ${
              a.state === "running" ? "text-blue-400" :
              a.state === "completed" ? "text-green-400" :
              a.state === "failed" ? "text-red-400" : "text-zinc-500"
            }`}>{a.state}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
