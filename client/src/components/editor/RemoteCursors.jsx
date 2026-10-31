import { useEffect, useRef, useState } from 'react';

/** Live pointers of other people, positioned from scene coordinates through the current viewport. */
export function RemoteCursors({ controller, session }) {
  const [, force] = useState(0);
  const cursors = useRef(new Map()); // userId -> { x, y, seen }
  const view = useRef({ zoom: 1, x: 0, y: 0 });
  const raf = useRef(0);
  const schedule = () => {
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; force((n) => n + 1); });
  };

  useEffect(() => {
    if (!controller || !session) return undefined;
    const offs = [
      controller.on('viewport', (v) => { view.current = v; schedule(); }),
      session.on('cursor', (c) => {
        if (c === null || c.gone) c === null ? cursors.current.clear() : cursors.current.delete(c.userId);
        else cursors.current.set(c.userId, { x: c.x, y: c.y, seen: Date.now() });
        schedule();
      }),
      session.on('presence', (list) => {
        const ids = new Set(list.map((p) => p.id));
        for (const id of cursors.current.keys()) if (!ids.has(id)) cursors.current.delete(id);
        schedule();
      }),
    ];
    // Hide pointers that have gone quiet (tab in background, mouse left the canvas).
    const sweep = setInterval(() => {
      let changed = false;
      for (const [id, c] of cursors.current) if (Date.now() - c.seen > 8000) { cursors.current.delete(id); changed = true; }
      if (changed) schedule();
    }, 2000);
    return () => { offs.forEach((off) => off()); clearInterval(sweep); cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [controller, session]);

  if (!session) return null;
  const { zoom, x, y } = view.current;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
      {[...cursors.current].map(([userId, c]) => {
        const user = session.participants.get(userId);
        if (!user) return null;
        return (
          <div key={userId} className="absolute left-0 top-0 will-change-transform" style={{ transform: `translate(${c.x * zoom + x}px, ${c.y * zoom + y}px)`, transition: 'transform 70ms linear' }}>
            <svg width="18" height="20" viewBox="0 0 18 20" fill={user.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round">
              <path d="M2 1.5v14l3.8-3.4 2.6 6 2.4-1-2.6-5.8h5.2z" />
            </svg>
            <span className="ml-3.5 -mt-1 inline-block max-w-[140px] truncate rounded-md px-1.5 py-0.5 text-xs font-medium text-white shadow-card" style={{ background: user.color }}>
              {user.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
