import { request } from './api.js';

// Contract: server/src/controllers/analytics.controller.js. `tz` = minutes east of UTC, so "today" and
// "hour of day" are the viewer's. Every number is a count of recorded changes (see the page's notice).
export const analyticsService = {
  get: (boardId, { days = 30 } = {}) => request(`/boards/${boardId}/analytics`, { query: { days, tz: -new Date().getTimezoneOffset() } }),
};
