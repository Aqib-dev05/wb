import { create } from 'zustand';

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — preference just won't persist */
  }
};

let toastId = 0;

export const useUiStore = create((set, get) => ({
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  boardView: read('cb-board-view', 'grid'),
  toasts: [],

  toggleTheme() {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    write('cb-theme', next);
    set({ theme: next });
  },

  setBoardView(view) {
    write('cb-board-view', view);
    set({ boardView: view });
  },

  toast(message, type = 'info') {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
