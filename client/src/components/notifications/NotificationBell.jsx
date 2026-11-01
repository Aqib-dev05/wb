import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { useDismiss } from '../../hooks/useCommon.js';
import { describe } from '../../hooks/useNotifications.js';
import { useNotificationStore } from '../../store/notificationStore.js';
import { cn, timeAgo } from '../../utils/format.js';
import { Avatar } from '../ui/Avatar.jsx';

/** Bell with an unread badge; opens the list of notices. Shown on the dashboard and in the editor. */
export function NotificationBell({ className }) {
  const navigate = useNavigate();
  const { items, unread, status, nextBefore, loadingMore, markRead, markAllRead, loadMore, load } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  useDismiss(ref, () => setOpen(false), open);

  useEffect(() => {
    if (open && status === 'error') load();
  }, [open, status, load]);

  const choose = (n) => {
    markRead([n.id]);
    setOpen(false);
    if (n.type !== 'removed') navigate(`/board/${n.boardId}`);
  };

  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <div ref={ref} className={cn('relative', className)} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); buttonRef.current?.focus(); } }}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn('relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink', open && 'bg-primary-soft text-primary')}
      >
        <Bell size={18} />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="anim-pop fixed inset-x-3 top-16 z-40 overflow-hidden rounded-2xl bg-surface shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[22rem]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-display text-sm font-semibold">Notifications</h2>
            <button type="button" onClick={markAllRead} disabled={!unread} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent">
              <CheckCheck size={14} /> Mark all as read
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto" aria-live="polite">
            {status === 'loading' && !items.length && <li className="px-4 py-6 text-center text-sm text-muted"><Loader2 size={16} className="mx-auto animate-spin" /></li>}
            {status === 'error' && !items.length && <li className="px-4 py-6 text-center text-sm text-danger">Couldn’t load notifications. Try again in a moment.</li>}
            {status === 'ready' && !items.length && (
              <li className="px-4 py-8 text-center">
                <Bell size={22} className="mx-auto mb-2 text-muted" />
                <p className="text-sm font-medium">You’re all caught up</p>
                <p className="mt-0.5 text-xs text-muted">When someone adds you to a board, you’ll see it here.</p>
              </li>
            )}
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => choose(n)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-surface-2 focus-visible:bg-surface-2', !n.read && 'bg-primary-soft/50')}>
                  <Avatar user={n.actor} size={32} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug">{describe(n)}</span>
                    <span className="mt-0.5 block text-xs text-muted">{timeAgo(n.createdAt)}{n.read ? '' : ' · New'}</span>
                  </span>
                  {!n.read && <span aria-hidden="true" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </button>
              </li>
            ))}
          </ul>
          {nextBefore && (
            <button type="button" onClick={loadMore} disabled={loadingMore} className="w-full border-t border-line px-4 py-2.5 text-sm font-medium text-primary hover:bg-surface-2 disabled:text-muted">
              {loadingMore ? 'Loading…' : 'Show older'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
