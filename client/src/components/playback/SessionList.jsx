import { Clock, Loader2, Radio, Users } from 'lucide-react';
import { formatClock, formatStart } from '../../playback/format.js';
import { cn } from '../../utils/format.js';
import { AvatarStack } from '../ui/Avatar.jsx';
import { Button } from '../ui/Button.jsx';

function SessionItem({ session, selected, onSelect }) {
  return (
    <li>
      <button
        onClick={() => onSelect(session.id)}
        aria-current={selected ? 'true' : undefined}
        className={cn('w-full rounded-xl border px-3 py-2.5 text-left transition', selected ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-surface-2')}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{formatStart(session.startedAt)}</span>
          {session.live && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral/15 px-1.5 py-0.5 text-[10px] font-semibold text-coral"><Radio size={10} />Live</span>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1"><Clock size={12} />{formatClock(session.durationMs)}</span>
            <span>{session.eventCount} {session.eventCount === 1 ? 'change' : 'changes'}</span>
          </span>
          <AvatarStack users={session.participants} size={18} max={3} />
        </div>
      </button>
    </li>
  );
}

/** Right-hand panel: the board's recorded sessions, newest first. */
export function SessionList({ list, selectedId, onSelect, onMore, loadingMore }) {
  const hasMore = list.meta && list.meta.page < list.meta.totalPages;
  return (
    <aside aria-label="Recorded sessions" className="pointer-events-auto absolute right-3 top-[68px] z-10 max-h-[calc(100%-132px)] w-64 overflow-y-auto rounded-2xl bg-surface shadow-pop">
      <div className="flex items-center gap-2 px-4 pb-1 pt-3.5">
        <Users size={15} className="text-muted" />
        <h2 className="font-display text-sm font-semibold tracking-tight">Sessions</h2>
        {list.meta && <span className="ml-auto text-xs text-muted">{list.meta.total}</span>}
      </div>
      {list.status === 'loading' && <div className="space-y-2 p-3" aria-label="Loading sessions" role="status">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>}
      {list.status === 'error' && <p role="alert" className="px-4 py-3 text-sm text-danger">{list.error}</p>}
      {list.status === 'ready' && list.items.length === 0 && (
        <p className="px-4 py-3 text-sm text-muted">Nothing recorded yet. Changes made on this board from now on are saved as sessions you can replay here.</p>
      )}
      {list.items.length > 0 && (
        <ul className="space-y-0.5 p-2">
          {list.items.map((s) => <SessionItem key={s.id} session={s} selected={s.id === selectedId} onSelect={onSelect} />)}
        </ul>
      )}
      {hasMore && (
        <div className="px-3 pb-3">
          <Button variant="secondary" size="sm" className="w-full" onClick={onMore} disabled={loadingMore} icon={loadingMore ? Loader2 : undefined}>Load older sessions</Button>
        </div>
      )}
    </aside>
  );
}
