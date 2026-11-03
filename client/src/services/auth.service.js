import { request, setAccessToken } from './api.js';

async function establish(promise) {
  const data = await promise;
  setAccessToken(data.accessToken);
  return data.user;
}

export const authService = {
  register: (payload) => establish(request('/auth/register', { method: 'POST', body: payload })),
  login: (payload) => establish(request('/auth/login', { method: 'POST', body: payload })),
  async logout() {
    try {
      await request('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
    }
  },
  forgotPassword: (email) => request('/auth/password/forgot', { method: 'POST', body: { email } }),
  resetPassword: (payload) => request('/auth/password/reset', { method: 'POST', body: payload }),
  updateName: async (name) => (await request('/auth/me', { method: 'PATCH', body: { name } })).user,
};
