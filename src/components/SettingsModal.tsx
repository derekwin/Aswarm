"use client";

import { useState } from "react";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [model, setModel] = useState(() => localStorage.getItem("model") || "qwen3:8b");
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [lang, setLang] = useState(() => localStorage.getItem("lang") || "en");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    localStorage.setItem("model", model);
    localStorage.setItem("theme", theme);
    localStorage.setItem("lang", lang);

    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decomposer_model: model, default_model: model }),
      });
    } catch { /* best effort */ }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-96 space-y-4 animate-fade-up" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Settings</h2>

        <label className="block text-sm text-zinc-400">Model</label>
        <input value={model} onChange={e => setModel(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500" />

        <label className="block text-sm text-zinc-400">Theme</label>
        <select value={theme} onChange={e => setTheme(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200">
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>

        <label className="block text-sm text-zinc-400">Language</label>
        <select value={lang} onChange={e => setLang(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200">
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>

        <div className="flex gap-2 pt-2">
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 bg-accent text-white text-sm rounded-lg hover:brightness-110 transition-all disabled:opacity-50">
            {saving ? "Saving..." : saved ? "✓ Saved" : "Save"}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-zinc-700 text-zinc-300 text-sm rounded-lg hover:bg-zinc-600">Close</button>
        </div>
      </div>
    </div>
  );
}
