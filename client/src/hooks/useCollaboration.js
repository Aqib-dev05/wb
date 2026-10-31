import { useEffect, useRef, useState } from 'react';
import { SyncSession } from '../socket/SyncSession.js';
import { boardService } from '../services/board.service.js';
import { useEditorStore } from '../store/editorStore.js';

const THUMBNAIL_IDLE_MS = 8000;

/**
 * Joins the board room for `controller` and mirrors connection state into the editor store.
 * Returns { session, loaded, failure }. `onRole` fires when the server changes our role.
 */
export function useCollaboration(controller, boardId, { onRole } = {}) {
  const [session, setSession] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState(null); // { kind: 'denied' | 'deleted' | 'kicked', message }
  const roleRef = useRef(onRole);
  roleRef.current = onRole;

  useEffect(() => {
    if (!controller) return undefined;
    const { setSync, setParticipants } = useEditorStore.getState();
    setSync({ status: 'connecting', pending: 0 });
    setParticipants([]);
    const s = new SyncSession(boardId, controller);
    setSession(s);

    let thumbTimer = null;
    let thumbDirty = false;
    const saveThumbnail = async () => {
      if (!thumbDirty || s.role === 'viewer' || s.status !== 'live') return;
      thumbDirty = false;
      try {
        await boardService.saveThumbnail(boardId, controller.thumbnail());
      } catch {
        thumbDirty = true; // preview is cosmetic; try again after the next edit burst
      }
    };
    const touchThumbnail = () => {
      thumbDirty = true;
      clearTimeout(thumbTimer);
      thumbTimer = setTimeout(saveThumbnail, THUMBNAIL_IDLE_MS);
    };

    const offs = [
      s.on('status', (status) => setSync({ status })),
      s.on('pending', (pending) => setSync({ pending })),
      s.on('presence', (list) => setParticipants(list)),
      s.on('loaded', () => { controller.zoomToFit(); setLoaded(true); }),
      s.on('role', (role) => roleRef.current?.(role)),
      s.on('error', (message) => useEditorStore.getState().setSync({ lastError: message })),
      s.on('kicked', (message) => setFailure({ kind: 'kicked', message })),
      s.on('deleted', (message) => setFailure({ kind: 'deleted', message })),
      controller.on('change', touchThumbnail),
    ];
    // Closing the tab with unsent edits: the browser's own prompt is the last line of defence.
    const warn = (e) => {
      if (s.unsyncedCount > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);

    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('beforeunload', warn);
      clearTimeout(thumbTimer);
      saveThumbnail();
      s.destroy();
      setSession(null);
    };
  }, [controller, boardId]);

  // The first status after a rejected join tells us why we couldn't enter.
  useEffect(() => {
    if (!session) return undefined;
    return session.on('status', (status) => {
      if (status === 'denied') setFailure((f) => f ?? { kind: 'denied', message: 'You do not have access to this board.' });
    });
  }, [session]);

  return { session, loaded, failure };
}
