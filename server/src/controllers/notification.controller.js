import * as notifications from '../services/notification.service.js';
import { asyncHandler, ok } from '../utils/http.js';

export const list = asyncHandler(async (req, res) => ok(res, await notifications.listNotifications(req.app.locals.store, req.user._id, req.query)));

export const markRead = asyncHandler(async (req, res) => ok(res, await notifications.markRead(req.app.locals.store, req.user._id, req.body)));
