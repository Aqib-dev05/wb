import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, History, Loader2, PanelRight, Share2, WifiOff } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { cn } from '../../utils/format.js';
import { Avatar, AvatarStack } from '../ui/Avatar.jsx';
import { Button, IconButton } from '../ui/Button.jsx';
import { ThemeToggle } from '../ui/ThemeToggle.jsx';

function SyncStatus({ readOnly }) {
  const { status, pending } = useEditorStore((s) => s.sync);
  let node;
  if (status === 'offline') {
    node = <><WifiOff size={15} className="text-danger" /><span className="hidden sm:inline">{pending ? `Offline · ${pending} unsynced` : 'Offline · reconnecting…'}</span></>;
  } else if (status === 'connecting') {
    node = <><Loader2 size={15} className="animate-spin" /><span className="hidden sm:inline">Connecting…</span></>;
  } else if (pending > 0) {
    node = <><Loader2 size={15} className="animate-spin" /><span className="hidden sm:inline">Syncing…</span></>;
  } else {
    node = <><Check size={15} className="text-mint" /><span className="hidden sm:inline">{readOnly ? 'Live · view only' : 'All changes synced'}</span></>;
  }
  return <span className="flex items-center gap-1.5 text-sm text-muted" role="status" aria-live="polite">{node}</span>;
}

function TitleField({ title, editable, onRename }) {
  const [draft, setDraft] = useState(null);
  const finish = async (save) => {
    const next = draft?.trim();
    setDraft(null);
    if (save && next && next !== title) await onRename(next);
  };
  if (draft === null) {
    return (
      <button
        disabled={!editable}
        onClick={() => setDraft(title)}
        title={editable ? 'Rename board' : undefined}
        className={cn('max-w-[40vw] truncate rounded-lg px-2 py-1 font-display text-base font-semibold tracking-tight', editable && 'hover:bg-surface-2')}
      >
        {title}
      </button>
    );
  }
  return (
    <input
      autoFocus
      aria-label="Board name"
      value={draft}
      maxLength={120}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') finish(false); }}
      className="h-8 w-56 max-w-[40vw] rounded-lg border border-primary bg-surface px-2 font-display text-base font-semibold tracking-tight focus:outline-none focus:ring-2 focus:ring-primary/25"
    />
  );
}

export function TopBar({ board, readOnly, onRename, onShare }) {
  const participants = useEditorStore((s) => s.participants);
  const user = useAuthStore((s) => s.user);
  const panelOpen = useEditorStore((s) => s.panelOpen);
  const togglePanel = useEditorStore((s) => s.togglePanel);
  return (
    <header className="pointer-events-auto absolute inset-x-3 top-3 z-20 flex h-12 items-center justify-between rounded-2xl bg-surface px-2 shadow-pop">
      <div className="flex min-w-0 items-center gap-1">
        <Link to="/" aria-label="Back to boards" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
          <ArrowLeft size={18} />
        </Link>
        <TitleField title={board.title} editable={!readOnly} onRename={onRename} />
      </div>
      <div className="flex items-center gap-3">
        <SyncStatus readOnly={readOnly} />
        <div className="flex items-center" aria-label={`${participants.length + 1} people on this board`}>
          <AvatarStack users={participants} max={4} size={28} />
          <span className={participants.length ? '-ml-1' : ''} title={`${user?.name} (you)`}><Avatar user={user} size={28} ring /></span>
        </div>
        <Link to={`/board/${board.id}/replay`} aria-label="Session history and replay" title="Session history and replay" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink">
          <History size={18} />
        </Link>
        <Button size="sm" icon={Share2} onClick={onShare}>Share</Button>
        <ThemeToggle />
        <IconButton label={panelOpen ? 'Hide properties' : 'Show properties'} icon={PanelRight} active={panelOpen} onClick={togglePanel} />
      </div>
    </header>
  );
}
