import { Maximize, Minus, Plus, Redo2, Undo2 } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore.js';
import { IconButton } from '../ui/Button.jsx';

export function BottomBar({ controller, readOnly }) {
  const zoom = useEditorStore((s) => s.viewport.zoom);
  const { canUndo, canRedo } = useEditorStore((s) => s.history);
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex items-end justify-between">
      <div className="pointer-events-auto flex rounded-xl bg-surface p-1 shadow-pop">
        {!readOnly && (
          <>
            <IconButton label="Undo (Ctrl+Z)" icon={Undo2} disabled={!canUndo} onClick={() => controller?.undo()} className="disabled:opacity-35" />
            <IconButton label="Redo (Ctrl+Shift+Z)" icon={Redo2} disabled={!canRedo} onClick={() => controller?.redo()} className="disabled:opacity-35" />
          </>
        )}
      </div>
      <div className="pointer-events-auto flex items-center rounded-xl bg-surface p-1 shadow-pop">
        <IconButton label="Zoom out (-)" icon={Minus} onClick={() => controller?.zoomBy(0.8)} />
        <button onClick={() => controller?.resetZoom()} title="Reset to 100% (0)" className="h-9 w-14 rounded-lg text-sm tabular-nums text-ink hover:bg-surface-2">
          {Math.round(zoom * 100)}%
        </button>
        <IconButton label="Zoom in (+)" icon={Plus} onClick={() => controller?.zoomBy(1.25)} />
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton label="Fit to content (Shift+1)" icon={Maximize} onClick={() => controller?.zoomToFit()} />
      </div>
    </div>
  );
}
