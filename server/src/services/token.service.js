import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env, isProd } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';

export const REFRESH_COOKIE = 'cb_refresh';
const MAX_SESSIONS_PER_USER = 5;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

function signRefreshToken(userId) {
  return jwt.sign({ sub: userId, jti: crypto.randomUUID() }, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
  });
}

export const refreshCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
};

/** Issues a new refresh token and stores only its hash on the user (max N concurrent sessions). */
export async function issueRefreshToken(userId) {
  const token = signRefreshToken(userId);
  const entry = {
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + refreshCookieOptions.maxAge),
  };
  await User.updateOne({ _id: userId }, { $push: { refreshTokens: { $each: [entry], $slice: -MAX_SESSIONS_PER_USER } } });
  return token;
}

/**
 * Rotates a refresh token. A valid JWT whose hash is no longer stored means the token was
 * already used (possible theft) — every session for that user is revoked.
 */
export async function rotateRefreshToken(oldToken) {
  let payload;
  try {
    payload = jwt.verify(oldToken, env.JWT_REFRESH_SECRET);
  } catch {
    throw ApiError.unauthorized('Session expired. Please sign in again.');
  }

  const hash = sha256(oldToken);
  const user = await User.findOne({ _id: payload.sub }).select('+refreshTokens');
  if (!user) throw ApiError.unauthorized('Session expired. Please sign in again.');

  const stored = user.refreshTokens.find((t) => t.tokenHash === hash && t.expiresAt > new Date());
  if (!stored) {
    await User.updateOne({ _id: user._id }, { $set: { refreshTokens: [] } });
    throw ApiError.unauthorized('Session expired. Please sign in again.');
  }

  await User.updateOne({ _id: user._id }, { $pull: { refreshTokens: { tokenHash: hash } } });
  const refreshToken = await issueRefreshToken(user._id);
  return { user, accessToken: signAccessToken(user._id.toString()), refreshToken };
}

export async function revokeRefreshToken(token) {
  if (!token) return;
  await User.updateOne({ 'refreshTokens.tokenHash': sha256(token) }, { $pull: { refreshTokens: { tokenHash: sha256(token) } } });
}
