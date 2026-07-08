import { useState, useRef, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { useConv } from '@/context/ConvContext';
import { useUI } from '@/context/UIContext';
import { useT } from '@/hooks/useT';
import { api } from '@/api';

interface Props {
  onSend: (convId: string, query: string) => void;
  onStop: () => void;
}

export default function InputBar({ onSend, onStop }: Props) {
  const { state: app, dispatch: appDispatch } = useApp();
  const { state: conv } = useConv();
  const { dispatch: uiDispatch } = useUI();
  const t = useT();

  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);
  const isExecuting = conv.execState === 'streaming' || conv.execState === 'decomposing' || conv.execState === 'reconnecting' || conv.execState === 'waiting_approval';
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (taRef.current && !conv.messages.length) {
      taRef.current.focus();
    }
  }, [conv.messages.length, app.activeConvId]);

  const autoResize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSending(true);
    try {
      const d = await api.uploadFile(file);
      if (d.content) {
        setQuery(q => q + '\n\n--- File: ' + d.filename + ' ---\n' + d.content.slice(0, 8000));
        setTimeout(autoResize, 50);
      } else if (d.error) {
        uiDispatch({ type: 'ADD_TOAST', payload: t('uploadFailed') + ': ' + d.error });
      }
    } catch {
      uiDispatch({ type: 'ADD_TOAST', payload: t('uploadFailed') });
    }
    setSending(false);
    e.target.value = '';
  };

  const submit = async () => {
    const q = query.trim();
    if (!q || sending) return;
    setSending(true);

    let convId = app.activeConvId;
    if (!convId) {
      try {
        const c = await api.createConversation();
        appDispatch({ type: 'ADD_CONV', payload: { id: c.id, title: c.title, created_at: c.created_at } });
        convId = c.id;
      } catch {
        uiDispatch({ type: 'ADD_TOAST', payload: t('createConvFailed') });
        setSending(false);
        return;
      }
    }
    if (app.conversations[convId]?.title === t('newTaskDefault')) {
      appDispatch({ type: 'SET_TITLE', payload: { id: convId, title: q.slice(0, 40) } });
    }
    setQuery('');
    onSend(convId, q);
    setSending(false);
  };

  return (
    <div className="px-6 py-1 pb-3 shrink-0">
      <div className="flex gap-2 max-w-[820px] mx-auto items-end">
        <label className="w-10 h-10 flex items-center justify-center rounded-lg cursor-pointer text-text-secondary text-sm hover:text-accent hover:bg-accent-soft transition-all shrink-0" title={t('uploadFile')}>
          <input type="file" accept=".pdf,.txt,.md,.py,.json,.csv" onChange={handleFile} className="hidden" />
          📎
        </label>
        <textarea
          ref={taRef}
          id="queryInput"
          value={query}
          onChange={e => { setQuery(e.target.value); autoResize(); }}
          placeholder={t('taskPlaceholder')}
          rows={1}
          className="input-base flex-1 min-h-[48px] max-h-[160px] resize-none leading-relaxed focus:shadow-glow transition-shadow"
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              if (isExecuting) return;
              e.preventDefault();
              submit();
            }
          }}
        />
        {isExecuting ? (
          <button className="btn-primary px-4 h-10 text-xs" onClick={onStop}>{t('stop')}</button>
        ) : (
          <button className="btn-primary px-4 h-10 text-xs" onClick={submit} disabled={sending || !query.trim() || isExecuting}>
            {t('send')}
          </button>
        )}
      </div>
    </div>
  );
}
