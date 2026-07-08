import { lazy, Suspense, memo } from 'react';
import { useConv } from '@/context/ConvContext';
import { useT } from '@/hooks/useT';
import AgentStatusList from '@/components/AgentStatusList';
import ApprovalCard from '@/components/ApprovalCard';

const Markdown = lazy(() => import('@/components/Markdown'));

interface Props {
  index: number;
  message: { role: string; content: string; typing?: boolean; approval?: { subtaskId: string; agentName: string; action: string; reasoning: string; riskLevel: string } };
  onEdit: (idx: number, text: string) => void;
  taskId?: string;
}

const MessageBubble = memo(function MessageBubble({ index, message, onEdit, taskId }: Props) {
  const { state: conv } = useConv();
  const t = useT();
  const isAssistant = message.role === 'assistant';
  const isFirstAssistant = index === conv.messages.findIndex(m => m.role === 'assistant');

  const avatarClass = isAssistant
    ? 'bg-gradient-to-br from-accent to-purple-400 text-white'
    : 'bg-gradient-to-br from-indigo-500 to-purple-500 text-white';

  return (
    <div className={`flex gap-3 animate-fade-up group ${!isAssistant ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarClass} ${message.typing ? 'ai-worker-avatar' : ''}`}>
        {isAssistant ? 'A' : 'U'}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`msg-bubble ${isAssistant ? 'msg-assistant' : 'msg-user'}`}>
          {message.typing ? (
            <span className="typing text-text-muted">{t('decomposing')}</span>
          ) : (
            <>
              {isFirstAssistant && !message.typing && <AgentStatusList />}
              <Suspense fallback={<div className="animate-shimmer h-4 rounded bg-bg-surface w-3/4" />}>
                <Markdown content={message.content} />
              </Suspense>
              {message.approval && (
                <ApprovalCard subtaskId={message.approval.subtaskId} taskId={taskId} />
              )}
            </>
          )}
        </div>
        <div className={`flex gap-2 mt-0.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity ${!isAssistant ? 'justify-end' : ''}`}>
          {!isAssistant && <button onClick={() => onEdit(index, message.content)} className="text-[11px] text-text-muted hover:text-accent font-medium" title={t('edit')}>{t('edit')}</button>}
          {isAssistant && !message.approval && <button onClick={() => { navigator.clipboard.writeText(message.content).catch(() => {}); }} className="text-[11px] text-text-muted hover:text-accent font-medium" title={t('copy')}>{t('copy')}</button>}
        </div>
      </div>
    </div>
  );
});

export default MessageBubble;
