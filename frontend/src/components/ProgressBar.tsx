import { useConv } from '@/context/ConvContext';

export default function ProgressBar() {
  const { state: conv } = useConv();
  const { completed, total } = conv.progress || { completed: 0, total: 0 };
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const totalChars = conv.messages.reduce((sum, m) => sum + m.content.length, 0);
  const estTokens = Math.round(totalChars / 4);

  return (
    <div className="flex items-center gap-3 px-4 shrink-0">
      <div className="flex-1 h-2 bg-bg-surface rounded-full overflow-hidden" style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #6366F1, #8B5CF6)' }} />
      </div>
      <span className="text-xs text-text-secondary font-mono whitespace-nowrap">{completed}/{total}</span>
      {conv.messages.some(m => m.role === 'assistant') && (
        <span className="text-xs text-text-muted whitespace-nowrap">~{estTokens} tok</span>
      )}
    </div>
  );
}
