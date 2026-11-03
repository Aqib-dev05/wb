import { LoginThrottle } from '../models/LoginThrottle.js';
import { OtpChallenge } from '../models/OtpChallenge.js';
import { User } from '../models/User.js';

// Persistence used by sign-in, sessions and password reset. tests/helpers/memoryAuthStore.js implements
// the same interface, so the logic above it is tested without a database.
// Every check-then-change that matters for security is ONE atomic update here (claiming a refresh token,
// spending an OTP attempt, counting a failed login), never a read followed by a write.

export const authStore = {
  findUserById: (id) => User.findById(id),
  findUserByEmail: (email, { withPassword = false } = {}) => (withPassword ? User.findOne({ email }).select('+passwordHash') : User.findOne({ email })),
  emailExists: (email) => User.exists({ email }),
  countUsers: () => User.estimatedDocumentCount(),
  createUser: (data) => User.create(data),

  /** Sets a new password, signs every device out (all refresh tokens), and stamps the change time. */
  setPassword: (userId, passwordHash, at) => User.updateOne({ _id: userId }, { $set: { passwordHash, passwordChangedAt: at, refreshTokens: [] } }),

  /* ───────────── refresh tokens ───────────── */

  async pushRefreshToken(userId, entry, max) {
    await User.updateOne({ _id: userId }, { $push: { refreshTokens: { $each: [entry], $slice: -max } } });
  },

  /**
   * Atomically marks a refresh token as used.
   *   'claimed' first use · 'grace' used a moment ago (two tabs at once) · 'reused' used earlier (copied token)
   *   'unknown' not stored (expired, signed out, or pushed out by newer sessions)
   */
  async claimRefreshToken(userId, tokenHash, now, graceMs) {
    const stamp = new Date(now);
    const first = await User.updateOne(
      { _id: userId, refreshTokens: { $elemMatch: { tokenHash, expiresAt: { $gt: stamp }, usedAt: null } } },
      { $set: { 'refreshTokens.$.usedAt': stamp } }
    );
    if (first.modifiedCount === 1) return 'claimed';
    const recent = await User.exists({ _id: userId, refreshTokens: { $elemMatch: { tokenHash, expiresAt: { $gt: stamp }, usedAt: { $gte: new Date(now - graceMs) } } } });
    if (recent) return 'grace';
    const used = await User.exists({ _id: userId, refreshTokens: { $elemMatch: { tokenHash, usedAt: { $ne: null } } } });
    return used ? 'reused' : 'unknown';
  },

  /** Drops tokens that are expired, or were used before `usedBefore` (kept a while so copying can be detected). */
  pruneRefreshTokens: (userId, now, usedBefore) =>
    User.updateOne({ _id: userId }, { $pull: { refreshTokens: { $or: [{ expiresAt: { $lte: new Date(now) } }, { usedAt: { $lt: new Date(usedBefore) } }] } } }),

  revokeRefreshToken: (tokenHash) => User.updateOne({ 'refreshTokens.tokenHash': tokenHash }, { $pull: { refreshTokens: { tokenHash } } }),
  revokeAllRefreshTokens: (userId) => User.updateOne({ _id: userId }, { $set: { refreshTokens: [] } }),

  /* ───────────── sign-in throttle (per email) ───────────── */

  async getLock(key, now) {
    const doc = await LoginThrottle.findOne({ key, lockedUntil: { $gt: new Date(now) } }).lean();
    return doc ? +doc.lockedUntil : null;
  },

  /** Counts one failed sign-in; locks the address once `max` failures happen within `windowMs`. Returns the lock end or null. */
  async recordLoginFailure(key, now, { max, windowMs, lockMs }) {
    const at = new Date(now);
    // A counter whose window already ended (the TTL sweep runs about once a minute) starts over.
    await LoginThrottle.updateOne({ key, expiresAt: { $lte: at } }, { $set: { count: 0, lockedUntil: null, expiresAt: new Date(now + windowMs) } });
    const doc = await LoginThrottle.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now + windowMs) } },
      { new: true, upsert: true }
    ).lean();
    if (doc.count >= max && !(doc.lockedUntil && doc.lockedUntil > at)) {
      await LoginThrottle.updateOne({ key }, { $set: { lockedUntil: new Date(now + lockMs), count: 0, expiresAt: new Date(now + lockMs) } });
      return now + lockMs;
    }
    return doc.lockedUntil && doc.lockedUntil > at ? +doc.lockedUntil : null;
  },

  clearLoginFailures: (key) => LoginThrottle.deleteOne({ key }),

  /* ───────────── one-time codes ───────────── */

  getChallenge: (userId, purpose) => OtpChallenge.findOne({ userId, purpose }).lean(),

  /** Replaces the user's live code with a new one (also resets attempts). */
  putChallenge: (c) =>
    OtpChallenge.updateOne({ userId: c.userId, purpose: c.purpose }, { $set: { ...c, attempts: 0, usedAt: null } }, { upsert: true }),

  /**
   * Spends one attempt on the live code and returns it (with the attempt number it just used), or null when there is
   * no usable code: none, expired, already used, or all attempts spent. Atomic, so parallel guesses each cost one attempt.
   */
  async spendAttempt(userId, purpose, now, maxAttempts) {
    const doc = await OtpChallenge.findOneAndUpdate(
      { userId, purpose, usedAt: null, expiresAt: { $gt: new Date(now) }, attempts: { $lt: maxAttempts } },
      { $inc: { attempts: 1 } },
      { new: true }
    ).lean();
    return doc && { id: String(doc._id), codeHash: doc.codeHash, attempt: doc.attempts };
  },

  /** True only for the single caller that gets to use the code. */
  async markChallengeUsed(id, now) {
    const r = await OtpChallenge.updateOne({ _id: id, usedAt: null }, { $set: { usedAt: new Date(now) } });
    return r.modifiedCount === 1;
  },

  deleteChallenge: (userId, purpose) => OtpChallenge.deleteOne({ userId, purpose }),
};
