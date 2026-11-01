import { request } from './api.js';

export const notificationService = {
  list: (query) => request('/notifications', { query }),
  markRead: (body) => request('/notifications/read', { method: 'POST', body }),
};
