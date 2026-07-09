"use client";

import { useState, useEffect } from "react";

type FileEntry = { name: string; path: string; type: string; size: number };

export function FilesPanel({ convId, onClose }: { convId: string; onClose: () => void }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/workspace/${convId}`).then(r => r.json())
      .then(d => { if (d.files) setFiles(d.files); }).catch(() => {});
  }, [convId]);

  const viewFile = async (path: string) => {
    const res = await fetch(`/api/workspace/${convId}/file?path=${encodeURIComponent(path)}`);
    const d = await res.json();
    setPreview(d.content || "[binary]");
  };

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden animate-fade-up">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-700">
        <span className="font-medium text-sm">Files</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">✕</button>
      </div>
      <div className="p-2 max-h-80 overflow-y-auto">
        {files.length === 0 ? (
          <p className="text-xs text-zinc-500 p-2">No files yet</p>
        ) : (
          <div className="space-y-0.5">
            {files.map(f => (
              <button key={f.path} onClick={() => viewFile(f.path)}
                className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-zinc-800 flex items-center gap-2 group">
                <span className="text-zinc-500">{f.type === "dir" ? "📁" : "📄"}</span>
                <span className="text-zinc-300 truncate flex-1">{f.name}</span>
                <span className="text-zinc-600 text-[10px]">{f.type === "file" ? `${(f.size / 1024).toFixed(1)}KB` : ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {preview !== null && (
        <div className="border-t border-zinc-700 p-3">
          <pre className="text-xs text-zinc-400 whitespace-pre-wrap max-h-48 overflow-auto font-mono">{preview}</pre>
        </div>
      )}
    </div>
  );
}
