import crypto from 'node:crypto';
import { ApiError } from '../utils/ApiError.js';
import { throttleKey } from './loginThrottle.js';
import { passwordChangedEmail, resetCodeEmail } from './mailer.js';

// Password reset by emailed one-time code.
//
//   forgot:  always answers the same way, whether or not the address has an account. If it does, a 6-digit code is
//            emailed. Cooldown (60 s) and an hourly cap (5) are enforced silently, so they reveal nothing either.
//   reset:   email + code + new password in ONE request (no intermediate token to steal). The code is single-use,
//            valid for 10 minutes, and 5 checks (right or wrong) kill it; every check is an atomic increment, so
//            parallel guesses cannot beat the limit. Only an HMAC of the code is stored.
//   success: every device is signed out (refresh tokens wiped, older access tokens rejected, live sockets cut),
//            and the person is told by email that the password changed.
//
// Worst case for an attacker who knows only the address: 5 codes/hour x 5 guesses of 1,000,000 = 0.0025% per hour.

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;
export const MAX_SENDS_PER_HOUR = 5;
const HOUR_MS = 3_600_000;
const PURPOSE = 'password_reset';

const invalidCode = () => new ApiError(400, 'INVALID_CODE', 'That code is wrong or has expired. Request a new one.');

export function createPasswordReset({ store, mailer, hashPassword, secret, now = () => Date.now(), randomCode, onPasswordReset, log = console }) {
  const pepper = crypto.createHmac('sha256', secret).update('collabboard-otp-v1').digest();
  const code = randomCode ?? (() => String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0'));
  const digest = (userId, value) => crypto.createHmac('sha256', pepper).update(`${userId}:${value}`).digest();
  const sameDigest = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
  const unknownDigest = digest('none', '000000'); // so "no such account" takes the same comparison path

  /** Emails a code if the address has an account and the limits allow. Resolves with { delivery } (the pending email, or null); callers should not wait for it. */
  async function requestReset(email) {
    const user = await store.findUserByEmail(email);
    if (!user) { sameDigest(unknownDigest, unknownDigest); return { delivery: null }; }
    const userId = String(user._id);
    const t = now();

    const current = await store.getChallenge(userId, PURPOSE);
    let sends = 1;
    let sendsWindowStart = t;
    if (current) {
      if (t - +current.sentAt < RESEND_COOLDOWN_MS) return { delivery: null };
      if (t - +current.sendsWindowStart < HOUR_MS) {
        if (current.sends >= MAX_SENDS_PER_HOUR) return { delivery: null };
        sends = current.sends + 1;
        sendsWindowStart = +current.sendsWindowStart;
      }
    }

    const value = code();
    await store.putChallenge({
      userId, purpose: PURPOSE, codeHash: digest(userId, value).toString('hex'),
      expiresAt: new Date(t + OTP_TTL_MS), sentAt: new Date(t), sends, sendsWindowStart: new Date(sendsWindowStart),
      purgeAt: new Date(Math.max(t + OTP_TTL_MS, sendsWindowStart + HOUR_MS)),
    });
    const message = resetCodeEmail({ name: user.name, code: value, minutes: OTP_TTL_MS / 60_000 });
    return { delivery: mailer.send({ to: user.email, ...message }).catch((err) => log.error('Could not send reset code:', err.message)) };
  }

  /** Checks the code and sets the new password. Throws INVALID_CODE for every kind of failure (same message, same shape). */
  async function resetPassword({ email, code: submitted, password }) {
    const user = await store.findUserByEmail(email);
    if (!user) { sameDigest(unknownDigest, digest('none', submitted)); throw invalidCode(); }
    const userId = String(user._id);

    const challenge = await store.spendAttempt(userId, PURPOSE, now(), MAX_ATTEMPTS);
    if (!challenge) throw invalidCode();
    if (!sameDigest(Buffer.from(challenge.codeHash, 'hex'), digest(userId, submitted))) throw invalidCode();
    if (!(await store.markChallengeUsed(challenge.id, now()))) throw invalidCode(); // a parallel request with the same code got there first

    await store.setPassword(userId, await hashPassword(password), new Date(now()));
    await store.deleteChallenge(userId, PURPOSE);
    await store.clearLoginFailures?.(throttleKey(email));
    try { await onPasswordReset?.(userId); } catch (err) { log.error('Could not end live sessions after reset:', err.message); }
    mailer.send({ to: user.email, ...passwordChangedEmail({ name: user.name }) }).catch((err) => log.error('Could not send password-changed notice:', err.message));
  }

  return { requestReset, resetPassword };
}
