"use client";

import { useState } from "react";

type Conv = { id: string; title: string; createdAt: string };

export function Sidebar({ conversations, activeId, onSelect, onNew }: {
  conversations: Conv[]; activeId: string | null; onSelect: (id: string) => void; onNew: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = search ? conversations.filter(c => c.title.toLowerCase().includes(search.toLowerCase())) : conversations;

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    try {
      await fetch(`/api/trpc/conversation.delete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: { id } }),
      });
    } catch { /* ignore */ }
    if (id === activeId) onNew();
  };

  return (
    <aside className="w-64 border-r border-zinc-800 flex flex-col shrink-0 bg-zinc-900 glass-heavy">
      <div className="p-3 space-y-2">
        <button onClick={onNew} className="w-full py-2 bg-accent text-white text-sm font-medium rounded-lg hover:brightness-110 transition-all">
          + New Task
        </button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filtered.length === 0 && <p className="text-center py-8 text-zinc-500 text-sm">No conversations</p>}
        {filtered.map(c => (
          <div key={c.id} className="group relative">
            <button onClick={() => onSelect(c.id)} className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${c.id === activeId ? "bg-zinc-800 text-zinc-200" : "text-zinc-400 hover:bg-zinc-800/50"}`}>
              {c.title || "New Task"}
            </button>
            <button onClick={e => handleDelete(e, c.id)} className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 text-xs transition-all">✕</button>
          </div>
        ))}
      </div>
    </aside>
  );
}
