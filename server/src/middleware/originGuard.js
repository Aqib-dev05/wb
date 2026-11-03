import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const allowed = new Set(env.CLIENT_ORIGIN.split(',').map((o) => o.trim()));

/**
 * CSRF defence for the cookie-based endpoints (refresh, logout) and everything else that changes data:
 * browsers always attach `Origin` to cross-site POST/PUT/PATCH/DELETE, so a request announcing an origin that is not
 * ours is refused. Requests without `Origin` (curl, server-to-server, same-origin GET) are not browsers acting for an
 * attacker's page and pass. Complements SameSite=Lax on the refresh cookie (which does not cover sibling sites).
 */
export function originGuard(req, _res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (origin && !allowed.has(origin)) return next(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Request came from an unexpected origin'));
  next();
}
