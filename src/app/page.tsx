"use client";

import { useState } from "react";

export default function Home() {
  const [n, setN] = useState(0);
  const [input, setInput] = useState("");

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">AgentSwarm</h1>
      <p className="text-zinc-400">Click test: {n}</p>
      <button onClick={() => setN(n + 1)} className="px-6 py-3 bg-blue-600 rounded-xl text-lg">
        Click Me
      </button>
      <div className="flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)}
          className="bg-zinc-800 border border-zinc-600 rounded px-3 py-2"
          placeholder="Type something..." />
        <button onClick={async () => {
          if (!input.trim()) return;
          try {
            const res = await fetch(`/api/trpc/conversation.create`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ json: { title: input.trim() } }),
            });
            const d = await res.json();
            alert("Created: " + JSON.stringify(d));
          } catch(e) { alert("Error: " + e); }
        }} className="px-4 py-2 bg-green-600 rounded-xl">
          Create Conv
        </button>
      </div>
    </div>
  );
}
