import { useState } from 'react';
import { Headphones, Mic, Video } from 'lucide-react';
import { useCallStore } from '../../store/callStore.js';
import { useUiStore } from '../../store/uiStore.js';
import { cn } from '../../utils/format.js';
import { Menu } from '../ui/Menu.jsx';

/** Top-bar entry point: start or join the call (and see that one is going on), or show/hide the call window. */
export function CallButton({ call }) {
  const status = useCallStore((s) => s.status);
  const count = useCallStore((s) => s.count);
  const minimized = useCallStore((s) => s.minimized);
  const toggleMinimized = useCallStore((s) => s.toggleMinimized);
  const toast = useUiStore((s) => s.toast);
  const [starting, setStarting] = useState(false);

  if (!call) return null; // browser without WebRTC / camera APIs

  const join = (options) => async () => {
    setStarting(true);
    const res = await call.join(options);
    setStarting(false);
    if (!res.ok) toast(res.message, 'error');
  };

  const inCall = status !== 'idle';
  const label = inCall ? (minimized ? 'Show call window' : 'Hide call window') : count ? `Join call, ${count} in it now` : 'Start call';
  const base = cn('relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition focus-visible:outline-2',
    inCall ? 'bg-mint/15 text-mint' : count ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink');
  const badge = !inCall && count > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">{count}</span>;

  if (inCall) {
    return <button type="button" onClick={toggleMinimized} aria-label={label} title={label} aria-pressed={!minimized} className={base}><Video size={18} aria-hidden="true" /></button>;
  }
  return (
    <Menu
      trigger={({ open }) => <button type="button" disabled={starting} aria-label={label} title={label} className={cn(base, open && 'bg-surface-2')}><Video size={18} aria-hidden="true" />{badge}</button>}
      items={[
        { label: 'Join with camera and mic', icon: Video, onSelect: join({ audio: true, video: true }) },
        { label: 'Join with mic only', icon: Mic, onSelect: join({ audio: true, video: false }) },
        { label: 'Join to listen and watch', icon: Headphones, onSelect: join({ audio: false, video: false }) },
      ]}
    />
  );
}
