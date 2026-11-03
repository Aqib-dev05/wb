// In-memory implementation of src/services/authStore.mongo.js, for tests. It follows the same rules as the
// Mongo queries (atomic claim, atomic attempt counting, TTL-less expiry checks by timestamp).
export function createMemoryAuthStore() {
  let n = 0;
  const users = new Map(); // id -> user
  const throttles = new Map();
  const challenges = new Map(); // `${userId}:${purpose}` -> challenge
  const nextId = () => (++n).toString(16).padStart(24, '0');

  const wrap = (u) => u && Object.assign(u, {
    toPublic() { return { id: this._id, name: this.name, email: this.email, color: this.color }; },
    async save() {},
  });

  return {
    users, throttles, challenges,
    async findUserById(id) { return wrap(users.get(String(id))) ?? null; },
    async findUserByEmail(email) { return wrap([...users.values()].find((u) => u.email === email)) ?? null; },
    async emailExists(email) { return [...users.values()].some((u) => u.email === email); },
    async countUsers() { return users.size; },
    async createUser(data) {
      const _id = nextId();
      const u = { _id, id: _id, passwordChangedAt: null, refreshTokens: [], ...data };
      users.set(_id, u);
      return wrap(u);
    },
    async setPassword(userId, passwordHash, at) {
      Object.assign(users.get(String(userId)), { passwordHash, passwordChangedAt: at, refreshTokens: [] });
    },

    async pushRefreshToken(userId, entry, max) {
      const u = users.get(String(userId));
      u.refreshTokens.push(entry);
      if (u.refreshTokens.length > max) u.refreshTokens = u.refreshTokens.slice(-max);
    },
    async claimRefreshToken(userId, tokenHash, now, graceMs) {
      const t = users.get(String(userId))?.refreshTokens.find((x) => x.tokenHash === tokenHash);
      if (!t) return 'unknown';
      if (!t.usedAt && t.expiresAt > new Date(now)) { t.usedAt = new Date(now); return 'claimed'; }
      if (t.usedAt && t.expiresAt > new Date(now) && +t.usedAt >= now - graceMs) return 'grace';
      return t.usedAt ? 'reused' : 'unknown';
    },
    async pruneRefreshTokens(userId, now, usedBefore) {
      const u = users.get(String(userId));
      u.refreshTokens = u.refreshTokens.filter((t) => t.expiresAt > new Date(now) && !(t.usedAt && +t.usedAt < usedBefore));
    },
    async revokeRefreshToken(tokenHash) { for (const u of users.values()) u.refreshTokens = u.refreshTokens.filter((t) => t.tokenHash !== tokenHash); },
    async revokeAllRefreshTokens(userId) { users.get(String(userId)).refreshTokens = []; },

    async getLock(key, now) { const t = throttles.get(key); return t?.lockedUntil > now ? t.lockedUntil : null; },
    async recordLoginFailure(key, now, { max, windowMs, lockMs }) {
      let t = throttles.get(key);
      if (!t || t.expiresAt <= now) throttles.set(key, (t = { count: 0, lockedUntil: null, expiresAt: now + windowMs }));
      t.count += 1;
      if (t.count >= max && !(t.lockedUntil > now)) { Object.assign(t, { lockedUntil: now + lockMs, count: 0, expiresAt: now + lockMs }); return t.lockedUntil; }
      return t.lockedUntil > now ? t.lockedUntil : null;
    },
    async clearLoginFailures(key) { throttles.delete(key); },

    async getChallenge(userId, purpose) { return challenges.get(`${userId}:${purpose}`) ?? null; },
    async putChallenge(c) { challenges.set(`${c.userId}:${c.purpose}`, { ...c, id: nextId(), attempts: 0, usedAt: null }); },
    async spendAttempt(userId, purpose, now, maxAttempts) {
      const c = challenges.get(`${userId}:${purpose}`);
      if (!c || c.usedAt || c.expiresAt <= new Date(now) || c.attempts >= maxAttempts) return null;
      c.attempts += 1;
      return { id: c.id, codeHash: c.codeHash, attempt: c.attempts };
    },
    async markChallengeUsed(id, now) {
      const c = [...challenges.values()].find((x) => x.id === id);
      if (!c || c.usedAt) return false;
      c.usedAt = new Date(now);
      return true;
    },
    async deleteChallenge(userId, purpose) { challenges.delete(`${userId}:${purpose}`); },
  };
}
