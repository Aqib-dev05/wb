import { Link } from 'react-router-dom';
import { ArrowLeft, History, PanelRight } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore.js';
import { formatStart } from '../../playback/format.js';
import { IconButton } from '../ui/Button.jsx';
import { ThemeToggle } from '../ui/ThemeToggle.jsx';

export function ReplayTopBar({ board, session }) {
  const panelOpen = useEditorStore((s) => s.panelOpen);
  const togglePanel = useEditorStore((s) => s.togglePanel);
  return (
    <header className="pointer-events-auto absolute inset-x-3 top-3 z-20 flex h-12 items-center justify-between rounded-2xl bg-surface px-2 shadow-pop">
      <div className="flex min-w-0 items-center gap-1">
        <Link to={`/board/${board.id}`} aria-label="Back to the board" title="Back to the board" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="max-w-[40vw] truncate px-2 font-display text-base font-semibold tracking-tight">{board.title}</h1>
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary"><History size={12} />Replay</span>
      </div>
      <div className="flex items-center gap-3">
        {session && <span className="hidden text-sm text-muted sm:inline">{formatStart(session.startedAt)}</span>}
        <ThemeToggle />
        <IconButton label={panelOpen ? 'Hide sessions' : 'Show sessions'} icon={PanelRight} active={panelOpen} onClick={togglePanel} />
      </div>
    </header>
  );
}
