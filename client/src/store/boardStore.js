import { create } from 'zustand';
import { boardService } from '../services/board.service.js';

let latestRequest = 0;

export const useBoardStore = create((set, get) => ({
  boards: [],
  meta: { page: 1, limit: 24, total: 0, totalPages: 1 },
  status: 'idle', // idle | loading | ready | error
  error: null,
  query: '',
  scope: 'all',

  setQuery: (query) => set({ query }),
  setScope: (scope) => set({ scope }),

  /** Loads the first page for the current filters. Stale responses are discarded. */
  async load() {
    const ticket = ++latestRequest;
    const { query, scope, meta } = get();
    set({ status: 'loading', error: null });
    try {
      const { data, meta: nextMeta } = await boardService.list({ q: query, scope, page: 1, limit: meta.limit });
      if (ticket !== latestRequest) return;
      set({ boards: data.boards, meta: nextMeta, status: 'ready' });
    } catch (err) {
      if (ticket !== latestRequest) return;
      set({ status: 'error', error: err.message });
    }
  },

  async loadMore() {
    const { meta, query, scope, boards, status } = get();
    if (status === 'loading' || meta.page >= meta.totalPages) return;
    const { data, meta: nextMeta } = await boardService.list({ q: query, scope, page: meta.page + 1, limit: meta.limit });
    set({ boards: [...boards, ...data.boards], meta: nextMeta });
  },

  async create(title) {
    const board = await boardService.create(title);
    set((s) => ({ boards: [board, ...s.boards], meta: { ...s.meta, total: s.meta.total + 1 } }));
    return board;
  },

  async rename(id, title) {
    const board = await boardService.rename(id, title);
    set((s) => ({ boards: s.boards.map((b) => (b.id === id ? board : b)) }));
  },

  /** Optimistic delete with rollback if the server refuses. */
  async remove(id) {
    const previous = get().boards;
    set((s) => ({ boards: s.boards.filter((b) => b.id !== id), meta: { ...s.meta, total: Math.max(0, s.meta.total - 1) } }));
    try {
      await boardService.remove(id);
    } catch (err) {
      set({ boards: previous });
      throw err;
    }
  },
}));
