import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RotateCcw } from 'lucide-react';
import { SPEEDS } from '../../playback/PlaybackEngine.js';
import { formatClock, presentAt } from '../../playback/format.js';
import { cn } from '../../utils/format.js';
import { AvatarStack } from '../ui/Avatar.jsx';
import { Button } from '../ui/Button.jsx';

/** Play/pause, scrubber, speed and "who was here" for the selected session. */
export function PlayerBar({ snap, session, rightInset, onToggle, onSeek, onSpeed }) {
  const [scrub, setScrub] = useState(null); // position being dragged; null = follow the engine
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (value) => {
    clearTimeout(timer.current);
    setScrub(null);
    onSeek(value);
  };
  const shown = scrub ?? snap.time;
  const people = presentAt(session.presence, shown);
  const Icon = snap.ended ? RotateCcw : snap.playing ? Pause : Play;
  const label = snap.ended ? 'Replay from the start' : snap.playing ? 'Pause (Space)' : 'Play (Space)';

  return (
    <section
      aria-label="Playback controls"
      className="pointer-events-auto absolute bottom-16 left-3 right-3 z-10 mx-auto max-w-2xl rounded-2xl bg-surface p-3 shadow-pop lg:right-(--player-right)"
      style={{ '--player-right': `${rightInset}px` }} // only wide screens reserve room for the side panel
    >
      {snap.error ? (
        <div role="alert" className="flex items-center justify-between gap-3 text-sm">
          <span className="text-danger">{snap.error}</span>
          <Button size="sm" variant="secondary" onClick={() => onSeek(snap.time)}>Retry</Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <button
              onClick={onToggle}
              disabled={snap.loading}
              aria-label={label}
              title={label}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-ink shadow-sm transition hover:brightness-110 disabled:opacity-60"
            >
              {snap.loading ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} className={Icon === Play ? 'translate-x-px' : ''} />}
            </button>
            <span className="w-24 shrink-0 text-sm tabular-nums text-ink" aria-hidden="true">
              {formatClock(shown)} <span className="text-muted">/ {formatClock(snap.duration)}</span>
            </span>
            <input
              type="range"
              aria-label="Playback position"
              aria-valuetext={`${formatClock(shown)} of ${formatClock(snap.duration)}`}
              min={0}
              max={Math.max(1, snap.duration)}
              step={100}
              value={Math.min(shown, Math.max(1, snap.duration))}
              disabled={snap.loading && !snap.duration}
              onChange={(e) => {
                const value = Number(e.target.value);
                setScrub(value);
                clearTimeout(timer.current);
                timer.current = setTimeout(() => commit(value), 350); // keyboard steps: seek once they settle
              }}
              onPointerUp={(e) => commit(Number(e.currentTarget.value))}
              className="h-2 min-w-0 flex-1 cursor-pointer accent-primary"
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted" role="status" aria-live="polite">
              {snap.loading ? 'Loading…' : snap.buffering ? 'Buffering…' : people.length ? (
                <>
                  <AvatarStack users={people} size={20} max={4} />
                  <span className="truncate">{people.map((p) => p.name).join(', ')} on the board</span>
                </>
              ) : (
                'Nobody on the board at this moment'
              )}
            </div>
            <div role="group" aria-label="Playback speed" className="flex rounded-lg bg-surface-2 p-0.5">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSpeed(s)}
                  aria-pressed={snap.speed === s}
                  className={cn('h-7 rounded-md px-2 text-xs font-medium tabular-nums transition', snap.speed === s ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
          {session.live && <p className="mt-2 text-xs text-muted">This session is still live. Playback covers it up to the moment you opened it.</p>}
        </>
      )}
    </section>
  );
}
