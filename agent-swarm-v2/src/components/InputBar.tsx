"use client";

import { useState } from "react";

export function InputBar({ onSubmit, onStop, disabled }: {
  onSubmit: (query: string) => void;
  onStop: () => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue("");
  };

  return (
    <div className="p-3 border-t border-zinc-800 shrink-0">
      <div className="flex gap-2 max-w-2xl mx-auto">
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          placeholder="Describe your task..."
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
        />
        {disabled ? (
          <button onClick={onStop} className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">
            Stop
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={!value.trim()} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
            Send
          </button>
        )}
      </div>
    </div>
  );
}
