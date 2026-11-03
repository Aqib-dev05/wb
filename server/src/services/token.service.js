import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env, isProd } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export const REFRESH_COOKIE = 'cb_refresh';
const MAX_SESSIONS_PER_USER = 5;
// Two tabs reopening after a browser restart both send the same refresh cookie at once. The second one is
// honoured for a few seconds instead of being treated as theft.
export const REFRESH_GRACE_MS = 10_000;
// A used token is remembered this long, so that presenting it again (a copied token) is recognised.
const USED_TOKEN_MEMORY_MS = 60 * 60_000;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const ISSUER = 'collabboard';

// Algorithm, issuer and audience are pinned on both sides, so a token minted for another purpose
// (or signed with "none" / a different algorithm) is never accepted as an access token.
// `pv` (password version) is the time of the user's last password change, 0 if never. A reset changes it, which makes every access token
// issued before the reset fail the comparison in requireAuth, exactly, with no clock-second edge cases.
const passwordVersion = (user) => (user?.passwordChangedAt ? +new Date(user.passwordChangedAt) : 0);

export function signAccessToken(userId, user) {
  return jwt.sign({ sub: userId, pv: passwordVersion(user) }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256', issuer: ISSUER, audience: 'access', expiresIn: env.ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: 'access' });
}

function signRefreshToken(userId) {
  return jwt.sign({ sub: userId, jti: crypto.randomUUID() }, env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256', issuer: ISSUER, audience: 'refresh', expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
  });
}

export const refreshCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
};

/** True when `payload` (a verified access token) was issued before the user's last password change. */
export const issuedBeforePasswordChange = (payload, user) => (payload.pv ?? 0) !== passwordVersion(user);

/** Sessions: refresh tokens live as hashes on the user (at most 5 devices); only the hash is ever stored. */
export function createSessionService(store, now = () => Date.now()) {
  const unauthorized = () => ApiError.unauthorized('Session expired. Please sign in again.');

  async function issueRefreshToken(userId) {
    const token = signRefreshToken(String(userId));
    await store.pushRefreshToken(userId, { tokenHash: sha256(token), expiresAt: new Date(now() + refreshCookieOptions.maxAge), usedAt: null }, MAX_SESSIONS_PER_USER);
    return token;
  }

  /**
   * Exchanges a refresh token for a new one (rotation). The old token is claimed atomically, so a token can only be
   * exchanged once. Presenting an already-used token after the grace period means it was copied: the account is signed out everywhere.
   */
  async function rotateRefreshToken(oldToken) {
    let payload;
    try {
      payload = jwt.verify(oldToken, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: 'refresh' });
    } catch {
      throw unauthorized();
    }
    const user = await store.findUserById(payload.sub);
    if (!user) throw unauthorized();

    const outcome = await store.claimRefreshToken(user._id, sha256(oldToken), now(), REFRESH_GRACE_MS);
    if (outcome === 'reused') {
      await store.revokeAllRefreshTokens(user._id);
      throw unauthorized();
    }
    if (outcome === 'unknown') throw unauthorized();

    const refreshToken = await issueRefreshToken(user._id);
    await store.pruneRefreshTokens(user._id, now(), now() - USED_TOKEN_MEMORY_MS);
    return { user, accessToken: signAccessToken(String(user._id), user), refreshToken };
  }

  const revokeRefreshToken = async (token) => { if (token) await store.revokeRefreshToken(sha256(token)); };

  return { issueRefreshToken, rotateRefreshToken, revokeRefreshToken };
}
