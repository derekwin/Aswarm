"use client";

type Conv = { id: string; title: string; createdAt: Date };

export function Sidebar({ conversations, activeId, onSelect, onNew }: {
  conversations: Conv[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <aside className="w-64 border-r border-zinc-800 flex flex-col shrink-0 bg-zinc-900">
      <div className="p-3 border-b border-zinc-800">
        <button onClick={onNew} className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          + New Task
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {conversations.map(c => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${
              c.id === activeId ? "bg-zinc-800 text-zinc-200" : "text-zinc-400 hover:bg-zinc-800/50"
            }`}
          >
            {c.title}
          </button>
        ))}
      </div>
    </aside>
  );
}
