import * as analytics from '../services/analytics.service.js';
import * as boards from '../services/board.service.js';
import { asyncHandler, ok } from '../utils/http.js';

// Like playback, analytics are readable by every member of the board; non-members get 404.
export const get = asyncHandler(async (req, res) => {
  await boards.getMembership(req.params.id, req.user._id);
  return ok(res, await analytics.getAnalytics(req.app.locals.store, req.params.id, req.query));
});
