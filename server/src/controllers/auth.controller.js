import { USER_COLORS } from '../models/User.js';
import { hashPassword, verifyPassword, DUMMY_HASH } from '../services/password.js';
import { REFRESH_COOKIE, refreshCookieOptions, signAccessToken } from '../services/token.service.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, ok } from '../utils/http.js';

const auth = (req) => req.app.locals.auth;
const clearCookie = (res) => res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions, maxAge: undefined });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startSession(req, res, user, status = 200) {
  const refreshToken = await auth(req).sessions.issueRefreshToken(user._id);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
  return ok(res, { user: user.toPublic(), accessToken: signAccessToken(user._id.toString(), user) }, { status });
}

export const register = asyncHandler(async (req, res) => {
  const { store } = auth(req);
  const { name, email, password } = req.body;
  if (await store.emailExists(email)) throw ApiError.conflict('An account with this email already exists');

  const user = await store.createUser({
    name,
    email,
    passwordHash: await hashPassword(password),
    color: USER_COLORS[(await store.countUsers()) % USER_COLORS.length],
  });
  return startSession(req, res, user, 201);
});

export const login = asyncHandler(async (req, res) => {
  const { store, throttle } = auth(req);
  const { email, password } = req.body;

  const lockedMs = await throttle.lockedFor(email);
  if (lockedMs) {
    res.set('Retry-After', String(Math.ceil(lockedMs / 1000)));
    throw new ApiError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${Math.ceil(lockedMs / 60_000)} minute(s), or reset your password.`);
  }

  const user = await store.findUserByEmail(email, { withPassword: true });
  const valid = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !valid) {
    await throttle.fail(email);
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  }
  await throttle.clear(email);
  return startSession(req, res, user);
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized('No active session');
  try {
    const { user, accessToken, refreshToken } = await auth(req).sessions.rotateRefreshToken(token);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
    return ok(res, { user: user.toPublic(), accessToken });
  } catch (err) {
    clearCookie(res);
    throw err;
  }
});

export const logout = asyncHandler(async (req, res) => {
  await auth(req).sessions.revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  clearCookie(res);
  return ok(res, { loggedOut: true });
});

export const me = asyncHandler(async (req, res) => ok(res, { user: req.user.toPublic() }));

export const updateMe = asyncHandler(async (req, res) => {
  req.user.name = req.body.name;
  await req.user.save();
  return ok(res, { user: req.user.toPublic() });
});

// Same answer, and the same minimum time, whether or not the address has an account.
const FORGOT_MIN_MS = 400;
export const forgotPassword = asyncHandler(async (req, res) => {
  const { passwordReset, forgotMinMs = FORGOT_MIN_MS } = auth(req);
  const started = Date.now();
  await passwordReset.requestReset(req.body.email); // the email itself is sent in the background
  const left = forgotMinMs - (Date.now() - started);
  if (left > 0) await sleep(left);
  return ok(res, { sent: true });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await auth(req).passwordReset.resetPassword(req.body);
  clearCookie(res);
  return ok(res, { reset: true });
});
