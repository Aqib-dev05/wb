import * as boards from '../services/board.service.js';
import * as playback from '../services/playback.service.js';
import { asyncHandler, ok } from '../utils/http.js';

// Every member (viewer and up) may watch a board's history; non-members get 404 like everywhere else.
const authorize = (req) => boards.getMembership(req.params.id, req.user._id);
const store = (req) => req.app.locals.store;

export const listSessions = asyncHandler(async (req, res) => {
  await authorize(req);
  const { items, meta } = await playback.listSessions(store(req), req.params.id, req.query);
  return ok(res, { sessions: items }, { meta });
});

export const getSession = asyncHandler(async (req, res) => {
  await authorize(req);
  return ok(res, { session: await playback.getSession(store(req), req.params.id, req.params.sessionId) });
});

export const listEvents = asyncHandler(async (req, res) => {
  await authorize(req);
  return ok(res, await playback.listSessionEvents(store(req), req.params.id, req.params.sessionId, req.query));
});

export const getState = asyncHandler(async (req, res) => {
  await authorize(req);
  return ok(res, await playback.stateAtOffset(store(req), req.params.id, req.params.sessionId, req.query.t));
});
