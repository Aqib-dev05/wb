import { create } from 'zustand';
import { refreshSession, setAccessToken, setSessionLostHandler } from '../services/api.js';
import { authService } from '../services/auth.service.js';

export const useAuthStore = create((set) => ({
  user: null,
  // loading: checking for an existing session on app start; then authenticated | guest
  status: 'loading',

  /** Restores a session from the refresh cookie. Called once on boot. */
  async init() {
    try {
      const { user } = await refreshSession();
      set({ user, status: 'authenticated' });
    } catch {
      set({ user: null, status: 'guest' });
    }
  },

  async login(credentials) {
    const user = await authService.login(credentials);
    set({ user, status: 'authenticated' });
  },

  async register(payload) {
    const user = await authService.register(payload);
    set({ user, status: 'authenticated' });
  },

  async logout() {
    try {
      await authService.logout();
    } finally {
      set({ user: null, status: 'guest' });
    }
  },

  async updateName(name) {
    const user = await authService.updateName(name);
    set({ user });
  },
}));

// If a silent refresh fails mid-session, drop to the sign-in screen.
setSessionLostHandler(() => {
  setAccessToken(null);
  useAuthStore.setState({ user: null, status: 'guest' });
});
