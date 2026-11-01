import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken, refreshSession } from '../services/api.js';
import { useNotificationStore } from '../store/notificationStore.js';
import { useUiStore } from '../store/uiStore.js';

const SENTENCE = {
  board_invite: (n) => `${n.actor.name} added you to “${n.boardTitle}” (${n.role === 'viewer' ? 'can view' : 'can edit'})`,
  role_changed: (n) => `${n.actor.name} changed your access to “${n.boardTitle}” to ${n.role === 'viewer' ? 'can view' : 'can edit'}`,
  removed: (n) => `${n.actor.name} removed you from “${n.boardTitle}”`,
};
export const describe = (n) => (SENTENCE[n.type] ?? (() => `${n.actor.name} updated “${n.boardTitle}”`))(n);

/**
 * One socket per signed-in tab for things addressed to the person rather than to a board.
 * Notices are saved on the server first, so the list is (re)loaded on connect: that covers
 * everything that arrived while this tab was closed, offline or reconnecting.
 */
export function useNotifications(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    const { load, receive, reset } = useNotificationStore.getState();
    load();

    const socket = io({
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
    });
    let first = true;
    socket.on('connect', () => {
      if (first) first = false;
      else load(); // came back after a gap: fetch what we missed
    });
    socket.on('connect_error', async (err) => {
      if (err.message !== 'TOKEN_EXPIRED') return;
      try {
        await refreshSession();
        socket.connect();
      } catch {
        /* signed out elsewhere; the auth store handles it */
      }
    });
    socket.on('notification:new', (payload) => {
      receive(payload);
      useUiStore.getState().toast(describe(payload.notification), 'info');
    });
    return () => {
      socket.close();
      reset();
    };
  }, [enabled]);
}
