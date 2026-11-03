import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { createMemoryMailer } from '../src/services/mailer.js';
import { createMemoryAuthStore } from './helpers/memoryAuthStore.js';
import { OTP_TTL_MS } from '../src/services/passwordReset.service.js';

// Real Express app (routes, validation, rate limits, cookies, JWT) on an in-memory auth store and mailer.
async function start({ start: t0 = Date.now(), rateLimits } = {}) {
  const clock = { t: t0 };
  const store = createMemoryAuthStore();
  const mailer = createMemoryMailer();
  const disconnected = [];
  const app = createApp({ authStore: store, mailer, now: () => clock.t, forgotMinMs: 0, rateLimits });
  app.locals.realtime = { disconnectUser: (id) => disconnected.push(id) };
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let n = 0;
  const call = async (method, path, { body, token, cookie, headers = {}, ip } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, json, data: json?.data, error: json?.error, setCookie, cookie: setCookie?.split(';')[0], headers: res.headers };
  };
  const register = (email = `u${++n}@x.dev`, password = 'Sturdy-pass-77', name = 'Test User') => call('POST', '/api/auth/register', { body: { name, email, password } }).then((r) => ({ ...r, email, password }));
  return { clock, store, mailer, disconnected, call, register, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const codeFrom = (mailer, i = -1) => /code is: (\d{6})/.exec(mailer.outbox.filter((m) => /reset code/.test(m.subject)).at(i).text)[1];

test('register, login, me, logout', async () => {
  const t = await start();
  try {
    const r = await t.register('ada@x.dev');
    assert.equal(r.status, 201); assert.ok(r.data.accessToken); assert.match(r.setCookie, /HttpOnly/i); assert.match(r.setCookie, /SameSite=Lax/i);
    assert.equal((await t.call('GET', '/api/auth/me', { token: r.data.accessToken })).data.user.email, 'ada@x.dev');
    const l = await t.call('POST', '/api/auth/login', { body: { email: 'ada@x.dev', password: 'Sturdy-pass-77' } });
    assert.equal(l.status, 200);
    assert.equal((await t.call('POST', '/api/auth/login', { body: { email: 'ada@x.dev', password: 'nope-nope-1' } })).status, 401);
    assert.equal((await t.call('POST', '/api/auth/logout', { cookie: l.cookie })).status, 200);
    assert.equal((await t.call('POST', '/api/auth/refresh', { cookie: l.cookie })).status, 401, 'a signed-out refresh token is dead');
  } finally { await t.close(); }
});

test('password policy: byte length, common passwords, own email', async () => {
  const t = await start();
  try {
    const bad = async (password, re, email = 'p@x.dev') => { const r = await t.register(email, password); assert.equal(r.status, 422, password); assert.match(r.error.message, re); };
    await bad('password123', /too common/);
    await bad('Qwerty123', /too common/);
    await bad('short1', /at least 8/);
    await bad('aä1'.repeat(30), /bytes/); // 90 characters but 120 bytes: bcrypt would cut it at 72
    await bad('noDigitsHere', /number/);
    await bad('paris.carter-2024', /email/, 'paris.carter@x.dev');
    assert.equal((await t.register('ok@x.dev', 'Correct-horse-9')).status, 201);
  } finally { await t.close(); }
});

test('access tokens: wrong algorithm, wrong audience, wrong secret, expired and tampered are all refused', async () => {
  const { default: jwt } = await import('jsonwebtoken');
  const t = await start();
  try {
    const r = await t.register('jwt@x.dev'); const id = (await t.call('GET', '/api/auth/me', { token: r.data.accessToken })).data.user.id;
    const secret = process.env.JWT_ACCESS_SECRET;
    const status = (token) => t.call('GET', '/api/auth/me', { token }).then((x) => x.status);
    assert.equal(await status(r.data.accessToken), 200);
    assert.equal(await status(jwt.sign({ sub: id }, secret, { algorithm: 'HS512', issuer: 'collabboard', audience: 'access' })), 401, 'HS512 is not accepted');
    assert.equal(await status(jwt.sign({ sub: id }, secret, { algorithm: 'HS256', issuer: 'collabboard', audience: 'refresh' })), 401, 'wrong audience');
    assert.equal(await status(jwt.sign({ sub: id }, secret, { algorithm: 'HS256', audience: 'access' })), 401, 'no issuer');
    assert.equal(await status(jwt.sign({ sub: id }, 'x'.repeat(40), { algorithm: 'HS256', issuer: 'collabboard', audience: 'access' })), 401, 'wrong secret');
    assert.equal(await status(`${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, iss: 'collabboard', aud: 'access' })).toString('base64url')}.`), 401, 'alg none');
    const expired = jwt.sign({ sub: id }, secret, { algorithm: 'HS256', issuer: 'collabboard', audience: 'access', expiresIn: -10 });
    const e = await t.call('GET', '/api/auth/me', { token: expired }); assert.equal(e.status, 401); assert.equal(e.error.code, 'TOKEN_EXPIRED');
    assert.equal(await status(r.data.accessToken.slice(0, -3) + 'abc'), 401, 'tampered signature');
  } finally { await t.close(); }
});

test('refresh rotation: single use, concurrent use tolerated, copied token signs the account out', async () => {
  const t = await start();
  try {
    const r = await t.register('rot@x.dev');
    const first = await t.call('POST', '/api/auth/refresh', { cookie: r.cookie });
    assert.equal(first.status, 200); assert.notEqual(first.cookie, r.cookie, 'a new refresh token is issued');
    // second tab, same old cookie, a moment later -> allowed, no logout
    t.clock.t += 2000;
    const second = await t.call('POST', '/api/auth/refresh', { cookie: r.cookie });
    assert.equal(second.status, 200, 'grace window for a second tab');
    // the first rotated token still works (the user's real session continues)
    assert.equal((await t.call('POST', '/api/auth/refresh', { cookie: first.cookie })).status, 200);
    // an hour of quiet later, the very first token shows up again: it was copied
    t.clock.t += 30_000;
    const replay = await t.call('POST', '/api/auth/refresh', { cookie: r.cookie });
    assert.equal(replay.status, 401);
    const user = [...t.store.users.values()][0];
    assert.equal(user.refreshTokens.length, 0, 'every session of the account was revoked');
    assert.equal((await t.call('POST', '/api/auth/refresh', { cookie: first.cookie })).status, 401, 'including the legitimate one');
  } finally { await t.close(); }
});

test('a refresh token that was never stored (or evicted) is refused without signing everyone out', async () => {
  const t = await start();
  try {
    const keep = await t.register('evict@x.dev');
    const { default: jwt } = await import('jsonwebtoken');
    const id = [...t.store.users.values()][0]._id;
    const stray = jwt.sign({ sub: id, jti: 'x' }, process.env.JWT_REFRESH_SECRET, { algorithm: 'HS256', issuer: 'collabboard', audience: 'refresh', expiresIn: '1d' });
    assert.equal((await t.call('POST', '/api/auth/refresh', { cookie: `cb_refresh=${stray}` })).status, 401);
    assert.equal((await t.call('POST', '/api/auth/refresh', { cookie: keep.cookie })).status, 200, 'the real session is untouched');
    // an access token is not a refresh token
    assert.equal((await t.call('POST', '/api/auth/refresh', { cookie: `cb_refresh=${keep.data.accessToken}` })).status, 401);
  } finally { await t.close(); }
});

test('at most 5 devices stay signed in; the oldest is dropped', async () => {
  const t = await start();
  try {
    const r = await t.register('dev@x.dev');
    const cookies = [r.cookie];
    for (let i = 0; i < 5; i++) cookies.push((await t.call('POST', '/api/auth/login', { body: { email: 'dev@x.dev', password: 'Sturdy-pass-77' } })).cookie);
    assert.equal([...t.store.users.values()][0].refreshTokens.length, 5);
    assert.equal((await t.call('POST', '/api/auth/refresh', { cookie: cookies[0] })).status, 401);
    assert.equal((await t.call('POST', '/api/auth/refresh', { cookie: cookies[5] })).status, 200);
  } finally { await t.close(); }
});

test('10 wrong passwords lock the address; real and made-up addresses look the same; reset still possible; success clears', async () => {
  const t = await start({ rateLimits: { credential: 1000 } });
  try {
    await t.register('lock@x.dev');
    const attempt = (email, password = 'wrong-pass-1') => t.call('POST', '/api/auth/login', { body: { email, password } });
    for (let i = 0; i < 10; i++) assert.equal((await attempt('lock@x.dev')).status, 401);
    const locked = await attempt('lock@x.dev', 'Sturdy-pass-77'); // even the right password is not tried while locked
    assert.equal(locked.status, 429); assert.equal(locked.error.code, 'ACCOUNT_LOCKED'); assert.ok(Number(locked.headers.get('retry-after')) > 0);
    for (let i = 0; i < 10; i++) await attempt('ghost@x.dev');
    const ghost = await attempt('ghost@x.dev'); assert.equal(ghost.status, 429, 'an address with no account locks the same way');
    assert.equal(ghost.error.message, locked.error.message);
    t.clock.t += 16 * 60_000;
    assert.equal((await attempt('lock@x.dev', 'Sturdy-pass-77')).status, 200, 'lock ends by itself');
    for (let i = 0; i < 9; i++) await attempt('lock@x.dev');
    assert.equal((await attempt('lock@x.dev', 'Sturdy-pass-77')).status, 200, 'a success clears the count');
    for (let i = 0; i < 9; i++) await attempt('lock@x.dev');
    assert.equal((await attempt('lock@x.dev')).status, 401, 'the counter started again from zero');
  } finally { await t.close(); }
});

test('cross-site writes are refused by the origin guard; same-site and header-less requests pass', async () => {
  const t = await start();
  try {
    const r = await t.register('csrf@x.dev');
    const evil = await t.call('POST', '/api/auth/refresh', { cookie: r.cookie, headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403); assert.equal(evil.error.code, 'ORIGIN_NOT_ALLOWED');
    assert.equal((await t.call('POST', '/api/auth/logout', { cookie: r.cookie, headers: { origin: 'https://evil.example' } })).status, 403);
    const ok = await t.call('POST', '/api/auth/refresh', { cookie: r.cookie, headers: { origin: 'http://localhost:5173' } });
    assert.equal(ok.status, 200);
    assert.equal((await t.call('GET', '/api/health', { headers: { origin: 'https://evil.example' } })).status, 200, 'reads are not blocked');
  } finally { await t.close(); }
});

/* ───────────── password reset ───────────── */

test('forgot password answers identically for known and unknown addresses; only the real one gets an email', async () => {
  const t = await start();
  try {
    await t.register('real@x.dev', undefined, 'Real <b>Person</b>');
    const a = await t.call('POST', '/api/auth/password/forgot', { body: { email: 'real@x.dev' } });
    const b = await t.call('POST', '/api/auth/password/forgot', { body: { email: 'nobody@x.dev' } });
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.deepEqual(a.json, b.json);
    assert.equal(t.mailer.outbox.length, 1); assert.equal(t.mailer.outbox[0].to, 'real@x.dev');
    const m = t.mailer.outbox[0];
    assert.match(m.text, /code is: \d{6}/); assert.match(m.text, /10 minutes/);
    assert.ok(!m.html.includes('<b>Person</b>') && m.html.includes('&lt;b&gt;Person&lt;/b&gt;'), 'name is escaped in the HTML part');
    assert.ok(!/https?:\/\//.test(m.text), 'no link in the email, so nothing to hijack through the Host header');
  } finally { await t.close(); }
});

test('forgot password never uses the Host header and validates the address', async () => {
  const t = await start();
  try {
    await t.register('host@x.dev');
    await t.call('POST', '/api/auth/password/forgot', { body: { email: 'host@x.dev' }, headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' } });
    assert.ok(!JSON.stringify(t.mailer.outbox).includes('evil.example'));
    assert.equal((await t.call('POST', '/api/auth/password/forgot', { body: { email: 'not-an-email' } })).status, 422);
    assert.equal((await t.call('POST', '/api/auth/password/forgot', { body: { email: { $ne: '' } } })).status, 422, 'operator objects are rejected');
  } finally { await t.close(); }
});

test('full reset: code works once, new password works, old does not, every device is signed out', async () => {
  const t = await start();
  try {
    const r = await t.register('flow@x.dev'); const other = await t.call('POST', '/api/auth/login', { body: { email: 'flow@x.dev', password: 'Sturdy-pass-77' } });
    await t.call('POST', '/api/auth/password/forgot', { body: { email: 'flow@x.dev' } });
    const code = codeFrom(t.mailer);
    const done = await t.call('POST', '/api/auth/password/reset', { body: { email: 'flow@x.dev', code, password: 'Brand-new-pass-5' } });
    assert.equal(done.status, 200); assert.equal(done.data.reset, true);
    assert.equal((await t.call('POST', '/api/auth/login', { body: { email: 'flow@x.dev', password: 'Sturdy-pass-77' } })).status, 401, 'old password is dead');
    assert.equal((await t.call('POST', '/api/auth/login', { body: { email: 'flow@x.dev', password: 'Brand-new-pass-5' } })).status, 200);
    assert.equal((await t.call('POST', '/api/auth/refresh', { cookie: r.cookie })).status, 401, 'refresh token from before is dead');
    assert.equal((await t.call('POST', '/api/auth/refresh', { cookie: other.cookie })).status, 401);
    assert.equal((await t.call('GET', '/api/auth/me', { token: r.data.accessToken })).status, 401, 'access token from before the reset is dead too');
    const fresh = await t.call('POST', '/api/auth/login', { body: { email: 'flow@x.dev', password: 'Brand-new-pass-5' } });
    assert.equal((await t.call('GET', '/api/auth/me', { token: fresh.data.accessToken })).status, 200, 'a token issued right after the reset works');
    assert.equal((await t.call('POST', '/api/auth/password/reset', { body: { email: 'flow@x.dev', code, password: 'Another-pass-66' } })).status, 400, 'the code cannot be reused');
    assert.equal(t.disconnected.length, 1, 'live sockets were closed');
    const notice = t.mailer.outbox.at(-1); assert.match(notice.subject, /password was changed/); assert.equal(notice.to, 'flow@x.dev');
  } finally { await t.close(); }
});

test('wrong codes: 5 tries then the code is dead, even the right one; every failure looks the same', async () => {
  const t = await start();
  try {
    await t.register('guess@x.dev');
    await t.call('POST', '/api/auth/password/forgot', { body: { email: 'guess@x.dev' } });
    const code = codeFrom(t.mailer); const wrong = code === '000000' ? '111111' : '000000';
    const reset = (c, email = 'guess@x.dev') => t.call('POST', '/api/auth/password/reset', { body: { email, code: c, password: 'Brand-new-pass-5' } });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await reset(wrong));
    assert.ok(results.every((x) => x.status === 400 && x.error.code === 'INVALID_CODE'));
    const afterLimit = await reset(code);
    assert.equal(afterLimit.status, 400); assert.deepEqual(afterLimit.error, results[0].error, 'the right code is refused after 5 tries, with the same message');
    const unknown = await reset(code, 'nobody@x.dev'); assert.deepEqual(unknown.error, results[0].error, 'unknown address gives the same error');
    assert.equal((await t.call('POST', '/api/auth/login', { body: { email: 'guess@x.dev', password: 'Brand-new-pass-5' } })).status, 401, 'password never changed');
  } finally { await t.close(); }
});

test('parallel guesses cannot beat the attempt limit', async () => {
  const t = await start();
  try {
    await t.register('par@x.dev');
    await t.call('POST', '/api/auth/password/forgot', { body: { email: 'par@x.dev' } });
    const code = codeFrom(t.mailer);
    const wrongs = Array.from({ length: 12 }, (_, i) => String(100000 + i).replace(code, '999999'));
    const all = await Promise.all([...wrongs, code].map((c) => t.call('POST', '/api/auth/password/reset', { body: { email: 'par@x.dev', code: c, password: 'Brand-new-pass-5' } })));
    const succeeded = all.filter((x) => x.status === 200).length;
    assert.ok(t.store.challenges.size === 1 || succeeded === 1);
    const ch = [...t.store.challenges.values()][0];
    if (ch) assert.ok(ch.attempts <= 5, `attempts stayed at or under 5 (got ${ch.attempts})`);
    assert.ok(succeeded <= 1, 'at most one request wins');
  } finally { await t.close(); }
});

test('two requests with the right code at the same moment: exactly one resets', async () => {
  const t = await start();
  try {
    await t.register('twice@x.dev');
    await t.call('POST', '/api/auth/password/forgot', { body: { email: 'twice@x.dev' } });
    const code = codeFrom(t.mailer);
    const go = (p) => t.call('POST', '/api/auth/password/reset', { body: { email: 'twice@x.dev', code, password: p } });
    const [a, b] = await Promise.all([go('First-winner-11'), go('Second-winner-22')]);
    assert.deepEqual([a.status, b.status].sort(), [200, 400]);
  } finally { await t.close(); }
});

test('code expires after 10 minutes; a new request replaces the old code', async () => {
  const t = await start();
  try {
    await t.register('exp@x.dev');
    await t.call('POST', '/api/auth/password/forgot', { body: { email: 'exp@x.dev' } });
    const old = codeFrom(t.mailer);
    t.clock.t += 61_000;
    await t.call('POST', '/api/auth/password/forgot', { body: { email: 'exp@x.dev' } });
    const fresh = codeFrom(t.mailer); assert.equal(t.mailer.outbox.length, 2);
    const reset = (c) => t.call('POST', '/api/auth/password/reset', { body: { email: 'exp@x.dev', code: c, password: 'Brand-new-pass-5' } });
    if (old !== fresh) assert.equal((await reset(old)).status, 400, 'the older code stopped working');
    t.clock.t += OTP_TTL_MS + 1000;
    assert.equal((await reset(fresh)).status, 400, 'expired');
  } finally { await t.close(); }
});

test('resend cooldown and hourly cap are enforced without telling the caller', async () => {
  const t = await start({ rateLimits: { forgot: 1000 } });
  try {
    await t.register('cap@x.dev');
    const ask = () => t.call('POST', '/api/auth/password/forgot', { body: { email: 'cap@x.dev' } });
    await ask(); await ask(); await ask();
    assert.equal(t.mailer.outbox.length, 1, 'within 60 s only the first goes out');
    for (let i = 0; i < 8; i++) { t.clock.t += 61_000; assert.equal((await ask()).status, 200); }
    assert.equal(t.mailer.outbox.length, 5, 'no more than 5 per hour');
    t.clock.t += 3_600_000;
    await ask(); assert.equal(t.mailer.outbox.length, 6, 'allowed again an hour later');
  } finally { await t.close(); }
});

test('IP rate limits on the reset endpoints', async () => {
  const t = await start();
  try {
    const hit = () => t.call('POST', '/api/auth/password/forgot', { body: { email: 'x@x.dev' } }).then((r) => r.status);
    const codes = []; for (let i = 0; i < 7; i++) codes.push(await hit());
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
  } finally { await t.close(); }
});

test('a broken mail server does not change the answer or leak anything', async () => {
  const t = await start();
  try {
    await t.register('down@x.dev'); t.mailer.fail = true;
    const r = await t.call('POST', '/api/auth/password/forgot', { body: { email: 'down@x.dev' } });
    assert.equal(r.status, 200); assert.deepEqual(r.data, { sent: true });
  } finally { await t.close(); }
});

test('reset validates the code format and applies the password policy', async () => {
  const t = await start();
  try {
    await t.register('pol@x.dev');
    const reset = (code, password) => t.call('POST', '/api/auth/password/reset', { body: { email: 'pol@x.dev', code, password } });
    assert.equal((await reset('12345', 'Brand-new-pass-5')).status, 422);
    assert.equal((await reset('abcdef', 'Brand-new-pass-5')).status, 422);
    const weak = await reset('123456', 'password123'); assert.equal(weak.status, 422); assert.match(weak.error.message, /common/);
    assert.equal((await t.call('POST', '/api/auth/password/reset', { body: { email: { $gt: '' }, code: '123456', password: 'Brand-new-pass-5' } })).status, 422);
  } finally { await t.close(); }
});

test('reset clears the sign-in lock so the owner can get back in', async () => {
  const t = await start();
  try {
    await t.register('unlock@x.dev');
    for (let i = 0; i < 10; i++) await t.call('POST', '/api/auth/login', { body: { email: 'unlock@x.dev', password: 'wrong-pass-1' } });
    assert.equal((await t.call('POST', '/api/auth/login', { body: { email: 'unlock@x.dev', password: 'Sturdy-pass-77' } })).status, 429);
    await t.call('POST', '/api/auth/password/forgot', { body: { email: 'unlock@x.dev' } });
    assert.equal((await t.call('POST', '/api/auth/password/reset', { body: { email: 'unlock@x.dev', code: codeFrom(t.mailer), password: 'Brand-new-pass-5' } })).status, 200);
    assert.equal((await t.call('POST', '/api/auth/login', { body: { email: 'unlock@x.dev', password: 'Brand-new-pass-5' } })).status, 200);
  } finally { await t.close(); }
});
