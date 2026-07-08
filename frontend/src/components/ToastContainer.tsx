import { useRef, useEffect } from 'react';
import { useUI } from '@/context/UIContext';

export default function ToastContainer() {
  const { state, dispatch } = useUI();
  const timerIds = useRef(new Set<number>());

  useEffect(() => {
    const currentIds = new Set(state.toasts.map(t => t.id));
    timerIds.current.forEach(id => { if (!currentIds.has(id)) timerIds.current.delete(id); });
    state.toasts.forEach(t => {
      if (!timerIds.current.has(t.id)) {
        timerIds.current.add(t.id);
        setTimeout(() => {
          timerIds.current.delete(t.id);
          dispatch({ type: 'REMOVE_TOAST', payload: t.id });
        }, 3000);
      }
    });
  }, [state.toasts, dispatch]);

  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-[200] pointer-events-none">
      {state.toasts.map(t => (
        <div key={t.id} className="px-4 py-2.5 glass text-white rounded-lg text-sm font-medium shadow-lg animate-slide-in-right pointer-events-auto flex items-center gap-3 relative overflow-hidden">
          <span className="flex-1">{t.message}</span>
          <button className="text-white/60 hover:text-white text-xs" onClick={() => dispatch({ type: 'REMOVE_TOAST', payload: t.id })}>✕</button>
          <div className="absolute bottom-0 left-0 h-0.5 bg-white/30 w-full">
            <div className="h-full bg-white toast-progress" />
          </div>
        </div>
      ))}
    </div>
  );
}
