import { ApiError } from '../utils/ApiError.js';

// In-app notifications. Everything goes through the injected `store` (Mongo in production, memory in
// tests), like playback and analytics. A notice is saved first and pushed over the socket second,
// so a person who is offline (or whose push is lost) still finds it in the list next time.

const DEFAULT_LIMIT = 30;

export const serialize = (n) => ({
  id: n.id,
  type: n.type,
  boardId: n.boardId,
  boardTitle: n.boardTitle,
  actor: { id: n.actor.id, name: n.actor.name, color: n.actor.color },
  role: n.role ?? null,
  createdAt: new Date(n.createdAt).toISOString(),
  read: Boolean(n.readAt),
});

/**
 * Creates a notice for `userId` and pushes it to their open tabs.
 * Never notifies people about their own actions. Returns the saved notice or null.
 */
export async function notify(store, realtime, { userId, actor, type, boardId, boardTitle, role }) {
  if (String(userId) === String(actor.id)) return null;
  const saved = await store.createNotification({ userId: String(userId), type, boardId: String(boardId), boardTitle, actor, role });
  const notification = serialize(saved);
  const unread = await store.countUnreadNotifications(String(userId));
  realtime?.notifyUser(String(userId), { notification, unread });
  return notification;
}

export async function listNotifications(store, userId, { limit = DEFAULT_LIMIT, before } = {}) {
  const rows = await store.listNotifications(String(userId), { limit: limit + 1, before });
  const page = rows.slice(0, limit).map(serialize);
  return {
    notifications: page,
    unread: await store.countUnreadNotifications(String(userId)),
    nextBefore: rows.length > limit ? page[page.length - 1].createdAt : null,
  };
}

/** Marks the caller's own notices read: `ids` (some of them) or `all`. Others' ids are ignored. */
export async function markRead(store, userId, { ids, all }) {
  if (!all && !ids?.length) throw ApiError.badRequest('Say which notifications to mark as read');
  await store.markNotificationsRead(String(userId), { ids: all ? null : ids });
  return { unread: await store.countUnreadNotifications(String(userId)) };
}
