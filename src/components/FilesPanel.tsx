"use client";

import { useState, useEffect } from "react";

type FileEntry = { name: string; path: string; type: string; size: number };

const WORKER = () => `http://${window.location.hostname}:8001`;

export function FilesPanel({ convId, onClose }: { convId: string; onClose: () => void }) {
  const [files, setFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    fetch(`${WORKER()}/workspace/${convId}`).then(r => r.json())
      .then(d => { if (d.files) setFiles(d.files); }).catch(() => {});
  }, [convId]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-80 bg-zinc-900 border-l border-zinc-700 z-50 animate-fade-up overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <span className="font-medium text-sm">Files</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg">✕</button>
        </div>
        <div className="p-2">
          {files.length === 0 ? (
            <p className="text-xs text-zinc-500 p-2">No files yet</p>
          ) : (
            <div className="space-y-0.5">
              {files.map(f => {
                const url = `${WORKER()}/workspace/${convId}/file?path=${encodeURIComponent(f.path)}`;
                return (
                  <div key={f.path} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 group">
                    <span className="text-zinc-500 text-xs">{f.type === "dir" ? "📁" : "📄"}</span>
                    <a href={url} target="_blank" rel="noreferrer"
                      className="text-zinc-300 text-xs truncate flex-1 hover:text-accent">
                      {f.name}
                    </a>
                    {f.type === "file" && (
                      <>
                        <span className="text-zinc-600 text-[10px] whitespace-nowrap">{(f.size / 1024).toFixed(1)}KB</span>
                        <a href={url} download className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 text-xs">⬇</a>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
