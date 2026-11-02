import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCallStore } from '../../store/callStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { cn } from '../../utils/format.js';
import { Avatar } from '../ui/Avatar.jsx';

function Media({ stream, muted, mirror, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) {
      el.srcObject = stream ?? null;
      el.play?.().catch(() => {}); // autoplay can be refused until the person interacts; the join click normally counts
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={cn('h-full w-full object-cover', mirror && '-scale-x-100', className)} />;
}

function Tile({ user, stream, showVideo, micOn, you, state }) {
  const label = you ? 'You' : user?.name ?? 'Guest';
  const waiting = !you && state !== 'connected';
  return (
    <div role="group" aria-label={`${label}${micOn ? '' : ', muted'}${showVideo ? '' : ', camera off'}`} className="relative h-[84px] w-[112px] shrink-0 overflow-hidden rounded-xl bg-[#1b1d29] sm:h-[96px] sm:w-[128px]">
      {/* Remote audio must keep playing even when the picture is hidden, so the element stays mounted. */}
      <div className={cn('absolute inset-0', !showVideo && 'invisible')}><Media stream={stream} muted={you} mirror={you} /></div>
      {!showVideo && <div className="absolute inset-0 flex items-center justify-center"><Avatar user={user} size={40} /></div>}
      {waiting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white" role="status">
          {state === 'failed' ? <span className="px-2 text-center text-[11px]">Can’t connect</span> : <Loader2 size={18} className="animate-spin" aria-label="Connecting" />}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-[11px] font-medium text-white">
        {!micOn && <MicOff size={12} aria-hidden="true" className="shrink-0 text-[#ff8a7a]" />}
        <span className="truncate">{label}</span>
      </div>
    </div>
  );
}

function RoundButton({ label, icon: Icon, onClick, pressed, danger, off, ...rest }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={pressed} {...rest}
      className={cn('inline-flex h-10 w-10 items-center justify-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2',
        danger ? 'bg-danger text-white hover:opacity-90' : off ? 'bg-[#ff6b57]/15 text-danger hover:bg-[#ff6b57]/25' : 'bg-surface-2 text-ink hover:bg-line')}>
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}

/** Floating call window: everyone's tile plus microphone / camera / leave. Shown only while we are in the call. */
export function CallPanel({ call }) {
  const { status, mic, cam, local, peers, notice, minimized } = useCallStore();
  const toggleMinimized = useCallStore((s) => s.toggleMinimized);
  const me = useAuthStore((s) => s.user);
  const [announce, setAnnounce] = useState('');
  const seen = useRef(new Map());

  useEffect(() => {
    const now = new Map(peers.map((p) => [p.socketId, p.user?.name ?? 'Someone']));
    for (const [id, name] of now) if (!seen.current.has(id)) setAnnounce(`${name} joined the call`);
    for (const [id, name] of seen.current) if (!now.has(id)) setAnnounce(`${name} left the call`);
    seen.current = now;
  }, [peers]);

  if (status === 'idle' || !call) return null;
  const busy = status !== 'active';

  return (
    <section aria-label="Call" className="pointer-events-auto absolute bottom-[4.5rem] left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col items-center gap-2 sm:bottom-3">
      {!minimized && (
        <div className="flex max-w-full gap-2 overflow-x-auto rounded-2xl bg-surface/95 p-2 shadow-pop">
          <Tile you user={me} stream={local} showVideo={cam} micOn={mic} />
          {peers.map((p) => <Tile key={p.socketId} user={p.user} stream={p.stream} showVideo={p.video && !!p.stream} micOn={p.audio} state={p.state} />)}
          {!peers.length && <p className="flex w-32 items-center px-2 text-xs text-muted">{status === 'active' ? 'Waiting for others to join…' : ''}</p>}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-full bg-surface px-2 py-1.5 shadow-pop">
        {busy ? (
          <span role="status" className="flex items-center gap-2 px-3 text-sm text-muted"><Loader2 size={15} className="animate-spin" aria-hidden="true" />{status === 'joining' ? 'Joining…' : 'Reconnecting call…'}</span>
        ) : (
          <>
            <RoundButton label={mic ? 'Mute microphone' : 'Turn on microphone'} icon={mic ? Mic : MicOff} off={!mic} pressed={!mic} onClick={() => call.setMic(!mic)} />
            <RoundButton label={cam ? 'Turn off camera' : 'Turn on camera'} icon={cam ? Video : VideoOff} off={!cam} pressed={!cam} onClick={() => call.setCam(!cam)} />
          </>
        )}
        <RoundButton label={minimized ? 'Show call window' : 'Hide call window'} icon={minimized ? ChevronUp : ChevronDown} onClick={toggleMinimized} aria-expanded={!minimized} pressed={undefined} />
        <RoundButton label="Leave call" icon={PhoneOff} danger onClick={() => call.leave()} />
      </div>
      {notice && <p role="status" className="max-w-sm rounded-lg bg-surface px-3 py-1.5 text-center text-xs text-ink shadow-pop">{notice}</p>}
      <p role="status" className="sr-only">{announce}</p>
    </section>
  );
}
