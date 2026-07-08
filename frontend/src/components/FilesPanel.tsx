import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { useUI } from '@/context/UIContext';
import { useT } from '@/hooks/useT';
import { api } from '@/api';

interface FileEntry { name: string; path: string; type: string; size: number }

async function openFileViewer(convId: string, path: string) {
  try {
    const data = await api.readFile(convId, path);
    const win = window.open('', '_blank', 'width=900,height=700');
    if (win) {
      const escaped = data.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      win.document.write(`<pre style="padding:20px;font-family:JetBrains Mono,monospace;font-size:13px;background:#0d0d0d;color:#fafafa;white-space:pre-wrap;line-height:1.6">${escaped}</pre>`);
    }
  } catch { /* ignore */ }
}

export default function FilesPanel() {
  const { state: app } = useApp();
  const { dispatch: uiDispatch } = useUI();
  const t = useT();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [error, setError] = useState('');
  const convId = app.activeConvId;

  useEffect(() => {
    if (!convId) return;
    let cancelled = false;
    api.listFiles(convId)
      .then(d => { if (!cancelled) { setFiles(d.files || []); setError(''); } })
      .catch(() => { if (!cancelled) setError(t('loadFilesFailed')); });
    return () => { cancelled = true; };
  }, [convId]);

  return (
    <div className="bg-bg-surface flex flex-col h-full">
      <div className="px-4 border-b border-border flex items-center justify-between h-[52px]">
        <h3 className="text-base font-semibold">{t('workspaceFiles')}</h3>
        <button className="btn-ghost w-7 h-7" onClick={() => uiDispatch({ type: 'CLOSE_PANEL' })}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {error ? (
          <div className="text-xs text-danger p-4">{error}</div>
        ) : files.length === 0 ? (
          <div className="text-xs text-text-muted p-4 text-center">{t('noFilesYet')}</div>
        ) : (
          <div className="flex flex-col gap-1">
            {files.map(f => (
              <div key={f.path} className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-white/4 text-left text-xs transition-colors group" onClick={() => { if (f.type === 'file') openFileViewer(convId!, f.path); }}>
                <span className="text-sm">{f.type === 'dir' ? '📁' : '📄'}</span>
                <span className="flex-1 truncate text-text-secondary">{f.name}</span>
                {f.type === 'file' && (
                  <>
                    <span className="text-text-muted">{f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`}</span>
                    <a href={`/api/workspace/${convId}/download?path=${encodeURIComponent(f.path)}`} download className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-[10px] bg-bg-surface border border-border-subtle text-text-secondary hover:text-accent hover:border-accent transition-all shrink-0" onClick={e => e.stopPropagation()}>
                      ⬇
                    </a>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
