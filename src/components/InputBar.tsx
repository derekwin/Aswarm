"use client";

import { useState } from "react";

export function InputBar({ onSubmit, onStop, disabled }: {
  onSubmit: (query: string) => void;
  onStop: () => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue("");
  };

  return (
    <div className="p-3 border-t border-zinc-800 shrink-0">
      <div className="flex gap-2 max-w-3xl mx-auto">
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Describe your task..."
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 transition-shadow"
        />
        {disabled ? (
          <button onClick={onStop} className="px-5 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors">
            Stop
          </button>
        ) : (
          <button onClick={submit} disabled={!value.trim()} className="px-5 py-2.5 bg-accent text-white text-sm font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            Send
          </button>
        )}
      </div>
    </div>
  );
}
