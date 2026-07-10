"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

type Agent = { name: string; role: string; state: string; subtaskId: string; output?: string; error?: string };

export function AgentDetailPanel({ agent, taskId, onClose }: {
  agent: Agent; taskId: string | null; onClose: () => void;
}) {
  const [trace, setTrace] = useState<{ event_type: string; data: Record<string, unknown> }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!taskId || !agent.subtaskId) return;
    fetch(`http://${window.location.hostname}:8001/trace/${taskId}/${agent.subtaskId}`)
      .then(r => r.json())
      .then(d => { if (d.trace_events) setTrace(d.trace_events); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId, agent.subtaskId]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-96 bg-zinc-900 border-l border-zinc-700 z-50 animate-fade-up overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${agent.state === "running" ? "bg-accent animate-pulse" : agent.state === "completed" ? "bg-green-400" : agent.state === "failed" ? "bg-red-400" : "bg-zinc-500"}`} />
            <span className="font-medium text-sm truncate">{agent.name}</span>
            {agent.role && <span className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded shrink-0">{agent.role}</span>}
            <span className={`text-[10px] shrink-0 ${agent.state === "running" ? "text-accent" : agent.state === "completed" ? "text-green-400" : "text-red-400"}`}>{agent.state}</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg">✕</button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {agent.output && (
            <div>
              <div className="text-xs font-semibold text-zinc-400 mb-2">Output</div>
              <div className="msg-bubble text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{agent.output}</ReactMarkdown>
              </div>
            </div>
          )}
          {agent.error && (
            <div className="p-2 bg-red-900/30 border border-red-800 rounded text-red-400 text-xs">{agent.error}</div>
          )}
          <div>
            <div className="text-xs font-semibold text-zinc-400 mb-2">Trace</div>
            {loading ? (
              <div className="animate-shimmer h-4 rounded bg-zinc-800 w-3/4" />
            ) : trace.length > 0 ? (
              <div className="space-y-1">
                {trace.map((evt, i) => (
                  <div key={i} className="p-2 bg-zinc-800 rounded text-xs">
                    <span className="text-accent font-mono">{evt.event_type}</span>
                    <span className="text-zinc-500 ml-2">{JSON.stringify(evt.data).slice(0, 80)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500 italic">No trace data</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
