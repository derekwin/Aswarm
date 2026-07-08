import { useState, useRef, useEffect, useCallback } from 'react';

export function usePanelWidth() {
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('panelWidth');
    return saved ? parseInt(saved, 10) : 360;
  });
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setWidth(Math.max(300, Math.min(700, newWidth)));
    };
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('panelWidth', String(width));
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [width]);

  return { panelWidth: width, onPanelResize: onMouseDown };
}
