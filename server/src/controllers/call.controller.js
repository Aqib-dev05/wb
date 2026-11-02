import { env } from '../config/env.js';
import { iceServersFor } from '../services/call.service.js';
import { ok } from '../utils/http.js';

/** ICE servers (STUN, optionally TURN with short-lived credentials) for the signed-in user's browser. */
export const iceServers = (req, res) => ok(res, { iceServers: iceServersFor(String(req.user._id), env) });
