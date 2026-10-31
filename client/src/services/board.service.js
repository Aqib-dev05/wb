import { request } from './api.js';

export const boardService = {
  list: (query) => request('/boards', { query, withMeta: true }),
  get: async (id) => (await request(`/boards/${id}`)).board,
  create: async (title) => (await request('/boards', { method: 'POST', body: title ? { title } : {} })).board,
  rename: async (id, title) => (await request(`/boards/${id}`, { method: 'PATCH', body: { title } })).board,
  getState: (id) => request(`/boards/${id}/state`),
  saveThumbnail: (id, thumbnail) => request(`/boards/${id}/thumbnail`, { method: 'PUT', body: { thumbnail } }),
  members: async (id) => (await request(`/boards/${id}/members`)).members,
  addMember: async (id, email, role) => (await request(`/boards/${id}/members`, { method: 'POST', body: { email, role } })).member,
  setRole: async (id, userId, role) => (await request(`/boards/${id}/members/${userId}`, { method: 'PATCH', body: { role } })).member,
  removeMember: (id, userId) => request(`/boards/${id}/members/${userId}`, { method: 'DELETE' }),
  remove: (id) => request(`/boards/${id}`, { method: 'DELETE' }),
};
