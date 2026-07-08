import { AnimatePresence, motion } from 'framer-motion';
import { useUI } from '@/context/UIContext';
import AgentDetailPanel from '@/components/AgentDetailPanel';
import FilesPanel from '@/components/FilesPanel';

interface Props {
  panelWidth: number;
  onPanelResize: (e: React.MouseEvent) => void;
}

export default function RightPanel({ panelWidth, onPanelResize }: Props) {
  const { state: ui } = useUI();

  return (
    <AnimatePresence>
      {ui.panelMode && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: window.innerWidth < 768 ? window.innerWidth : panelWidth, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 overflow-hidden glass-heavy border-l border-border-subtle max-md:fixed max-md:inset-0 max-md:z-[140] relative"
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:w-1.5 hover:bg-accent/40 bg-accent/10 transition-all z-10 max-md:hidden"
            onMouseDown={onPanelResize}
          />
          <div style={{ width: panelWidth }} className="h-full">
            {ui.panelMode === 'agent' ? <AgentDetailPanel /> : <FilesPanel />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
