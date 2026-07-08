import { useState } from 'react';
import { useConv } from '@/context/ConvContext';
import { api } from '@/api';

interface Props {
  subtaskId: string;
  taskId?: string;
}

export default function ApprovalCard({ subtaskId, taskId }: Props) {
  const { dispatch: convDispatch } = useConv();
  const [feedback, setFeedback] = useState('');
  const [resolved, setResolved] = useState(false);

  if (resolved) return null;

  const handle = async (approved: boolean) => {
    setResolved(true);
    try {
      if (taskId) {
        await api.approveAction(taskId, subtaskId, approved, feedback);
      }
    } catch { /* best effort */ }
    convDispatch({
      type: 'RESOLVE_APPROVAL_MSG',
      payload: { resolved: approved ? '✓ Approved' : '✗ Rejected' },
    });
  };

  return (
    <div className="mt-3 p-3 rounded-lg border border-warning/40 bg-warning/5 animate-fade-up">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Optional feedback..."
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            className="input-base text-xs w-full mb-2"
          />
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-success text-white hover:brightness-110 transition-all"
            onClick={() => handle(true)}
          >
            ✓ Approve
          </button>
          <button
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-bg-surface text-danger border border-danger/30 hover:bg-danger/10 transition-all"
            onClick={() => handle(false)}
          >
            ✗ Reject
          </button>
        </div>
      </div>
    </div>
  );
}
