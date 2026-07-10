"use client";

import { useState } from "react";

type Conv = { id: string; title: string; createdAt: string };

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, loading }: {
  conversations: Conv[]; activeId: string | null; onSelect: (id: string) => void; onNew: () => void;
  onDelete?: (id: string) => void; loading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filtered = search ? conversations.filter(c => c.title.toLowerCase().includes(search.toLowerCase())) : conversations;

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
    if (next.size === 0) setSelectMode(false);
  };

  const batchDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} conversation(s)?`)) return;
    for (const id of selected) {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => {});
      if (id === activeId && onDelete) onDelete(id);
    }
    setSelected(new Set()); setSelectMode(false);
  };

  return (
    <aside className="w-64 border-r border-zinc-800 flex flex-col shrink-0 bg-zinc-900 glass-heavy">
      <div className="p-3 space-y-2">
        <button onClick={onNew} className="w-full py-2 bg-accent text-white text-sm font-medium rounded-lg hover:brightness-110 transition-all">+ New Task</button>
        <div className="flex gap-1">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-zinc-500" />
          {conversations.length > 0 && (
            <button onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }} className={`px-2 py-1 text-xs rounded ${selectMode ? "bg-accent text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}>☐</button>
          )}
        </div>
      </div>

      {selectMode && selected.size > 0 && (
        <div className="px-3 py-2 border-b border-zinc-700 bg-red-900/20">
          <button onClick={batchDelete} className="w-full py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700">Delete {selected.size}</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          [1,2,3,4,5].map(i => <div key={i} className="animate-shimmer px-3 py-2 rounded-lg"><div className="h-3.5 rounded bg-zinc-700 w-4/5" /></div>)
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-zinc-500 text-sm">No conversations</p>
        ) : (
          filtered.map(c => (
            <div key={c.id} className={`flex items-center gap-1 rounded-lg ${c.id === activeId && !selectMode ? "bg-zinc-800" : "hover:bg-zinc-800/50"}`}>
              {selectMode && (
                <button onClick={() => toggleSelect(c.id)} className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs ml-1 ${selected.has(c.id) ? "bg-accent text-white" : "bg-zinc-700 text-zinc-500"}`}>✓</button>
              )}
              <button onClick={() => selectMode ? toggleSelect(c.id) : onSelect(c.id)} className={`flex-1 text-left px-3 py-2 text-sm truncate ${c.id === activeId && !selectMode ? "text-zinc-200" : "text-zinc-400"}`}>{c.title || "New Task"}</button>
              {!selectMode && onDelete && (
                <button onClick={(e) => { e.stopPropagation(); if (confirm("Delete this conversation?")) onDelete(c.id); }} className="shrink-0 text-zinc-500 hover:text-red-400 text-xs px-2 py-1">✕</button>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
