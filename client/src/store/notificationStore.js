import { create } from 'zustand';
import { notificationService } from '../services/notification.service.js';

const MAX_KEPT = 100;

/** `items` newest first. `unread` comes from the server (it counts notices that are not loaded too). */
export const useNotificationStore = create((set, get) => ({
  items: [],
  unread: 0,
  nextBefore: null,
  status: 'idle', // idle | loading | ready | error
  loadingMore: false,

  async load() {
    set({ status: 'loading' });
    try {
      const { notifications, unread, nextBefore } = await notificationService.list({ limit: 30 });
      set({ items: notifications, unread, nextBefore, status: 'ready' });
    } catch {
      set({ status: get().items.length ? 'ready' : 'error' });
    }
  },

  async loadMore() {
    const { nextBefore, loadingMore } = get();
    if (!nextBefore || loadingMore) return;
    set({ loadingMore: true });
    try {
      const { notifications, nextBefore: next } = await notificationService.list({ limit: 30, before: nextBefore });
      set((s) => ({
        items: [...s.items, ...notifications.filter((n) => !s.items.some((x) => x.id === n.id))].slice(0, MAX_KEPT * 3),
        nextBefore: next,
        loadingMore: false,
      }));
    } catch {
      set({ loadingMore: false });
    }
  },

  /** A notice pushed over the socket. */
  receive({ notification, unread }) {
    set((s) => ({
      items: s.items.some((n) => n.id === notification.id) ? s.items : [notification, ...s.items],
      unread,
    }));
  },

  async markRead(ids) {
    const targets = ids.filter((id) => get().items.some((n) => n.id === id && !n.read));
    if (!targets.length) return;
    set((s) => ({ items: s.items.map((n) => (targets.includes(n.id) ? { ...n, read: true } : n)), unread: Math.max(0, s.unread - targets.length) }));
    try {
      const { unread } = await notificationService.markRead({ ids: targets });
      set({ unread });
    } catch {
      get().load(); // the server is the truth; resync
    }
  },

  async markAllRead() {
    if (!get().unread) return;
    set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })), unread: 0 }));
    try {
      const { unread } = await notificationService.markRead({ all: true });
      set({ unread });
    } catch {
      get().load();
    }
  },

  reset: () => set({ items: [], unread: 0, nextBefore: null, status: 'idle', loadingMore: false }),
}));
