import { useState, useRef, useEffect, useCallback } from 'react';
import { useConv } from '@/context/ConvContext';
import { useT } from '@/hooks/useT';
import MessageBubble from '@/components/MessageBubble';

interface Props { onEditRerun: (query: string) => void; taskId?: string; }

export default function ResultStream({ onEditRerun, taskId }: Props) {
  const { state: conv } = useConv();
  const t = useT();
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const fillInput = (val: string) => {
    const el = document.getElementById('queryInput') as HTMLTextAreaElement | null;
    if (el) { el.value = val; el.focus(); }
  };

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledRef.current = !atBottom;
    setShowScrollBtn(!atBottom && el.scrollHeight > el.clientHeight + 100);
    if (atBottom && paused) setPaused(false);
  }, [paused]);

  useEffect(() => {
    if (conv.messages.length === 0) userScrolledRef.current = false;
  }, [conv.messages.length]);

  useEffect(() => {
    if (!paused && scrollRef.current && !userScrolledRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' as ScrollBehavior });
    }
  }, [conv.messages, paused]);

  if (!conv.messages.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
        <div className="text-2xl mb-1">✦</div>
        <h2 className="text-xl font-bold text-text-primary">{t('emptyTitle')}</h2>
        <p className="text-base">{t('emptyDesc')}</p>
        <div className="flex flex-wrap gap-2 justify-center mt-4">
          {(['suggestionResearch', 'suggestionCompare', 'suggestionReport'] as const).map(key => (
            <button key={key} onClick={() => fillInput(t(key))} className="btn-secondary btn-sm rounded-full">{t(key)}</button>
          ))}
        </div>
      </div>
    );
  }

  const startEdit = (idx: number, text: string) => { setEditingIdx(idx); setEditText(text); };
  const cancelEdit = () => setEditingIdx(null);
  const submitEdit = () => {
    const text = editText.trim();
    if (!text || text === conv.messages[editingIdx!]?.content) return cancelEdit();
    // Fill input with the edited text so runTask treats it like a new submission
    const el = document.getElementById('queryInput') as HTMLTextAreaElement | null;
    if (el) { el.value = text; el.focus(); }
    setEditingIdx(null);
    // Trigger a new task run with the edited text — runTask will append user + assistant messages
    onEditRerun(text);
  };

  return (
    <div className="flex flex-col h-full max-w-[820px] mx-auto w-full px-6 relative">
      <div ref={scrollRef} className="flex-1" onScroll={onScroll}>
        <div className="flex flex-col gap-5 py-3">
          {conv.messages.map((m, i) => (
            editingIdx === i ? (
              <div key={i} className="flex gap-3 animate-fade-up">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0">U</div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col gap-2">
                    <textarea value={editText} onChange={e => setEditText(e.target.value)} autoFocus
                      className="input-base min-h-[40px] resize-y"
                      onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitEdit(); }} />
                    <div className="flex gap-2">
                      <button onClick={submitEdit} className="btn-primary btn-sm">{t('rerun')}</button>
                      <button onClick={cancelEdit} className="btn-secondary btn-sm">{t('cancel')}</button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <MessageBubble key={i} index={i} message={m} onEdit={startEdit} taskId={taskId} />
            )
          ))}
        </div>
      </div>
      {showScrollBtn && (
        <button className="absolute bottom-2 left-1/2 -translate-x-1/2 h-8 px-3 rounded-full bg-accent text-white text-xs font-medium flex items-center gap-1.5 shadow-lg hover:brightness-110 transition-all z-10"
          onClick={() => {
            userScrolledRef.current = false;
            setShowScrollBtn(false);
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
          }}>
          <span>↓</span>
        </button>
      )}
    </div>
  );
}
