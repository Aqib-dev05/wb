import { request } from './api.js';

// Read-only history of a board's recorded sessions. Contract: server/src/controllers/playback.controller.js
export const playbackService = {
  sessions: (boardId, query) => request(`/boards/${boardId}/sessions`, { query, withMeta: true }),
  session: async (boardId, sessionId) => (await request(`/boards/${boardId}/sessions/${sessionId}`)).session,
  /** { events, hasMore, nextAfter } — changes in sequence order, `after` is the last sequence already held. */
  events: (boardId, sessionId, { after = 0, limit = 300 } = {}) => request(`/boards/${boardId}/sessions/${sessionId}/events`, { query: { after, limit } }),
  /** { sequence, offsetMs, objects } — the board `t` ms after the session started. */
  state: (boardId, sessionId, t) => request(`/boards/${boardId}/sessions/${sessionId}/state`, { query: { t: Math.max(0, Math.round(t)) } }),
};
