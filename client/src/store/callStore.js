import { create } from 'zustand';

const initial = () => ({
  status: 'idle', // idle | joining | active | reconnecting
  notice: null,
  mic: false,
  cam: false,
  local: null,
  peers: [],
  count: 0, // people on the call right now (known even when we are not in it)
  minimized: false,
});

export const useCallStore = create((set) => ({
  ...initial(),
  apply: (snapshot) => set(snapshot),
  setCount: (count) => set({ count }),
  toggleMinimized: () => set((s) => ({ minimized: !s.minimized })),
  clearNotice: () => set({ notice: null }),
  reset: () => set(initial()),
}));
