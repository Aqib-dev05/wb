import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, Info } from 'lucide-react';
import { formatDuration, formatNumber } from '../analytics/format.js';
import { ActivePeoplePerDay, BusiestHours, Contribution, OpsByType, SessionsPerDay } from '../components/analytics/Charts.jsx';
import { Heatmap } from '../components/analytics/Heatmap.jsx';
import { Button } from '../components/ui/Button.jsx';
import { ThemeToggle } from '../components/ui/ThemeToggle.jsx';
import { analyticsService } from '../services/analytics.service.js';
import { boardService } from '../services/board.service.js';
import { cn, timeAgo } from '../utils/format.js';

const RANGES = [7, 14, 30, 60];
const tzLabel = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone';

function Kpi({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>
      <div className="grid gap-5 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-72 rounded-2xl" />)}</div>
    </div>
  );
}

function Unavailable({ title, message }) {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted">{message}</p>
      <Link to="/"><Button variant="secondary" className="mt-4">Back to boards</Button></Link>
    </div>
  );
}

function Report({ boardId, board }) {
  const [days, setDays] = useState(30);
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  const load = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    analyticsService.get(boardId, { days })
      .then((data) => !cancelled && setState({ status: 'ready', data, error: null }))
      .catch((err) => !cancelled && setState({ status: 'error', data: null, error: err.message }));
    return () => { cancelled = true; };
  }, [boardId, days]);
  useEffect(() => load(), [load]);

  const { status, data, error } = state;
  const empty = data && data.totals.changes === 0 && data.totals.sessions === 0;

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-1">
            <Link to={`/board/${boardId}`} aria-label="Back to the board" title="Back to the board" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
              <ArrowLeft size={18} />
            </Link>
            <h1 className="truncate px-2 font-display text-base font-semibold tracking-tight">{board.title}</h1>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary"><BarChart3 size={12} />Analytics</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-muted">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>
            These are <strong className="font-medium text-ink">interaction metrics</strong>: counts of changes recorded on this board and of times people were on it.
            They don’t measure attention or engagement. Someone who only watches leaves no changes, and cursor movement isn’t recorded.
          </span>
        </p>

        {status === 'loading' && !data && <Skeleton />}
        {status === 'error' && (
          <div role="alert" className="rounded-2xl border border-line bg-surface p-6 text-center">
            <p className="font-medium">We couldn’t load the analytics</p>
            <p className="mt-1 text-sm text-muted">{error}</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={load}>Try again</Button>
          </div>
        )}

        {data && empty && (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-line px-6 py-16 text-center">
            <BarChart3 size={32} className="mb-3 text-muted" />
            <h2 className="font-display text-lg font-semibold">Nothing to show yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted">Analytics are built from recorded changes and sessions. Work on this board, then come back.</p>
            <Link to={`/board/${boardId}`}><Button className="mt-4">Open the board</Button></Link>
          </div>
        )}

        {data && !empty && (
          <div className={cn('space-y-5 transition-opacity', status === 'loading' && 'opacity-60')} aria-busy={status === 'loading'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">Daily charts cover the last {days} days. Everything else covers the board's whole history.</p>
              <div role="group" aria-label="Time range for the daily charts" className="flex rounded-lg bg-surface-2 p-0.5">
                {RANGES.map((r) => (
                  <button key={r} onClick={() => setDays(r)} aria-pressed={days === r} className={cn('h-8 rounded-md px-2.5 text-xs font-medium tabular-nums transition', days === r ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                    {r}d
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Kpi label="Changes" value={formatNumber(data.totals.changes)} hint={data.totals.lastChangeAt ? `Last one ${timeAgo(data.totals.lastChangeAt)}` : 'None yet'} />
              <Kpi label="People who made changes" value={formatNumber(data.totals.people)} />
              <Kpi label="Sessions" value={formatNumber(data.totals.sessions)} hint="Anyone on the board" />
              <Kpi label="Time on the board" value={formatDuration(data.totals.sessionMs)} hint="Sum of all sessions" />
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <SessionsPerDay daily={data.daily} days={data.window.days} />
              <ActivePeoplePerDay daily={data.daily} days={data.window.days} />
              <OpsByType opsByType={data.opsByType} createdByKind={data.createdByKind} total={data.totals.changes} />
              <Contribution users={data.users} total={data.totals.changes} />
              <BusiestHours hours={data.hours} total={data.totals.changes} tzLabel={tzLabel()} />
              <Heatmap heatmap={data.heatmap} />
            </div>

            <p className="text-center text-xs text-muted">
              Up to change #{formatNumber(data.asOf.sequence)} · computed {timeAgo(data.asOf.computedAt)}
              {data.asOf.stale && ' · a few newer changes are not included yet; reload in a moment'}.
              Day boundaries use your current UTC offset for the whole period.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function AnalyticsPage() {
  const { id } = useParams();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    boardService.get(id)
      .then((board) => !cancelled && setState({ status: 'ready', board }))
      .catch((err) => !cancelled && setState({ status: 'error', error: err.message }));
    return () => { cancelled = true; };
  }, [id]);

  if (state.status === 'loading') return <div className="flex h-full items-center justify-center"><div className="skeleton h-5 w-40 rounded" role="status" aria-label="Loading board" /></div>;
  if (state.status === 'error') return <Unavailable title="We couldn’t open this board" message={state.error} />;
  return <Report key={id} boardId={id} board={state.board} />;
}
