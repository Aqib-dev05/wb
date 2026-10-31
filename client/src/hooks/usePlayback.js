import { useEffect, useState } from 'react';
import { PlaybackEngine } from '../playback/PlaybackEngine.js';
import { playbackService } from '../services/playback.service.js';

/**
 * Creates a PlaybackEngine for `session`, drawing into the (read-only) `controller`.
 * Returns { engine, snap }: `snap` is the engine's latest public state, null until a session is chosen.
 * Nothing here touches the live board: history comes from the playback endpoints only.
 */
export function usePlayback(controller, boardId, session) {
  const [state, setState] = useState({ engine: null, snap: null });

  useEffect(() => {
    if (!controller || !session) return undefined;
    let cancelled = false;
    const engine = new PlaybackEngine({
      startedAt: Date.parse(session.startedAt),
      durationMs: session.durationMs,
      source: {
        loadState: (ms) => playbackService.state(boardId, session.id, ms),
        loadEvents: (after) => playbackService.events(boardId, session.id, { after }),
      },
      view: {
        reset: (objects) => controller.replaceAll(objects),
        apply: (ops) => controller.applyLocalOps(ops),
      },
    });
    const off = engine.subscribe((snap) => !cancelled && setState({ engine, snap }));
    setState({ engine, snap: engine.snapshot() });

    (async () => {
      // Aim the camera at where the session ends up, so its activity is in view from the first second.
      // Purely a nicety: if it fails, playback itself will surface any real error.
      try {
        const final = await playbackService.state(boardId, session.id, session.durationMs);
        if (cancelled) return;
        await controller.load(final.objects);
        if (cancelled) return;
        controller.zoomToFit();
      } catch {
        /* keep the default camera */
      }
      if (!cancelled) engine.start();
    })();

    return () => {
      cancelled = true;
      off();
      engine.dispose();
    };
  }, [controller, boardId, session]);

  // Without a session there is nothing to show, whatever a previous session left in state.
  return controller && session ? state : { engine: null, snap: null };
}
