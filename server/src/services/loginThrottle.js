import crypto from 'node:crypto';

// Per-ADDRESS brake on password guessing. The per-IP rate limit stops one machine; this stops a botnet
// trying one account from many addresses. 10 failures in 15 minutes lock that email address for 15 minutes.
// The counter is keyed on the address, not the account, so real and made-up addresses behave identically.
// While locked, passwords are not even checked (guessing gets nowhere) but "forgot password" still works.
// Trade-off: someone can lock a known address out for 15 minutes by failing on purpose.
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_LOCK_MS = 15 * 60_000;

export const throttleKey = (email) => crypto.createHash('sha256').update(email).digest('hex');

export const createLoginThrottle = (store, now = () => Date.now()) => ({
  /** Milliseconds left on the lock, or 0. */
  async lockedFor(email) {
    const until = await store.getLock(throttleKey(email), now());
    return until ? Math.max(0, until - now()) : 0;
  },
  fail: (email) => store.recordLoginFailure(throttleKey(email), now(), { max: LOGIN_MAX_FAILURES, windowMs: LOGIN_WINDOW_MS, lockMs: LOGIN_LOCK_MS }),
  clear: (email) => store.clearLoginFailures(throttleKey(email)),
});
