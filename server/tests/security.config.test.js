import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createApp } from '../src/app.js';
import { createMemoryMailer } from '../src/services/mailer.js';
import { createMemoryAuthStore } from './helpers/memoryAuthStore.js';
import { emit, once, startServer, BOARD } from './helpers/harness.js';

test('production refuses to start without SMTP, with short or identical JWT secrets', () => {
  const run = (extra) => spawnSync(process.execPath, ['-e', "import('./src/config/env.js').then(()=>console.log('STARTED'))"], {
    cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_ENV: 'production', MONGODB_URI: 'mongodb://x', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), ...extra },
  });
  assert.match(run({}).stderr, /SMTP_URL is required in production/);
  assert.match(run({ SMTP_URL: 'smtp://x', JWT_ACCESS_SECRET: 'short' }).stderr, /JWT_ACCESS_SECRET must be at least 32/);
  assert.match(run({ SMTP_URL: 'smtp://x', JWT_REFRESH_SECRET: 'a'.repeat(40) }).stderr, /must differ/);
  assert.match(run({ SMTP_URL: 'smtp://x' }).stdout, /STARTED/);
});

test('X-Forwarded-For cannot dodge the rate limit unless a proxy is trusted (TRUST_PROXY=0)', async () => {
  const app = createApp({ authStore: createMemoryAuthStore(), mailer: createMemoryMailer(), forgotMinMs: 0 });
  const server = http.createServer(app); await new Promise((r) => server.listen(0, r));
  try {
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/password/forgot`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}` }, body: JSON.stringify({ email: 'a@x.dev' }) });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429], 'spoofed addresses all count as the same client');
  } finally { server.close(); }
});

test('resetting a password closes that person\'s live sockets, and only theirs', async () => {
  const t = await startServer();
  try {
    const [ada1, ada2, bob] = [await t.connect('ada'), await t.connect('ada'), await t.connect('bob')];
    const closed = [once(ada1, 'disconnect', 2000), once(ada2, 'disconnect', 2000)];
    t.realtime.disconnectUser('65a000000000000000000001');
    await Promise.all(closed);
    assert.equal(ada1.connected, false); assert.equal(ada2.connected, false); assert.equal(bob.connected, true);
    assert.equal((await emit(bob, 'board:join', { boardId: BOARD })).ok, true);
  } finally { await t.close(); }
});
