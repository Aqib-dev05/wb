import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANALYTICS_VERSION } from '../src/services/analytics.reducer.js';
import { getAnalytics, localDate } from '../src/services/analytics.service.js';
import { BOARD, USERS, batch, create, emit, quiet, startServer } from './helpers/harness.js';
import { createMemoryStore } from './helpers/memoryStore.js';

const D = (iso) => +new Date(iso);
const NOW = D('2026-03-05T12:00:00Z');
const ADA = USERS.ada.id;
const BOB = USERS.bob.id;
const GONE = '65a0000000000000000000ff'; // a user who no longer exists

const newStore = () => createMemoryStore({ users: Object.values(USERS) });

/** Writes events straight into the store with real sequence numbers (no sockets). */
async function seed(store, list, boardId = BOARD) {
  for (const [type, objectId, payload, userId, at] of list) {
    const [sequence] = [await store.allocateSequence(boardId, 1)];
    await store.insertEvents([{ boardId, sequence, type, objectId, payload, userId, createdAt: new Date(at), sessionId: null }]);
  }
}
const make = (id, kind, left, top) => ['object:created', id, { object: { id, kind, left, top, width: 100, height: 100 } }, ADA];
const T = { early: D('2026-03-02T21:40:00Z'), mid: D('2026-03-04T08:00:00Z'), late: D('2026-03-05T09:20:00Z') };

async function fixtureStore() {
  const store = newStore();
  await seed(store, [
    [...make('r1', 'rect', 0, 0), T.early],
    ['object:created', 's1', { object: { id: 's1', kind: 'sticky', left: 300, top: 0, width: 100, height: 100 } }, BOB, T.mid],
    ['object:updated', 'r1', { patch: { left: 500 } }, ADA, T.mid],
    ['object:deleted', 's1', {}, GONE, T.late],
  ]);
  return store;
}

test('totals, per-person breakdown and names (a removed account becomes "Former member")', async () => {
  const store = await fixtureStore();
  const r = await getAnalytics(store, BOARD, { now: NOW });
  assert.equal(r.totals.changes, 4);
  assert.equal(r.totals.people, 3);
  assert.deepEqual(r.opsByType, [{ type: 'created', count: 2 }, { type: 'updated', count: 1 }, { type: 'deleted', count: 1 }, { type: 'reordered', count: 0 }]);
  assert.deepEqual(r.createdByKind, [{ kind: 'rect', count: 1 }, { kind: 'sticky', count: 1 }]);
  assert.deepEqual(r.users.map((u) => [u.name, u.changes]), [['Ada', 2], ['Bob', 1], ['Former member', 1]]);
  assert.equal(r.users.find((u) => u.name === 'Ada').share, 0.5);
  assert.equal(r.totals.firstChangeAt, new Date(T.early).toISOString());
  assert.equal(r.totals.lastChangeAt, new Date(T.late).toISOString());
  assert.equal(r.asOf.sequence, 4);
});

test('the daily series is zero-filled, ends today, and follows the viewer\'s timezone', async () => {
  const store = await fixtureStore();
  const utc = await getAnalytics(store, BOARD, { now: NOW, days: 7, tz: 0 });
  assert.equal(utc.daily.length, 7);
  assert.deepEqual(utc.daily.map((d) => d.date), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']);
  assert.deepEqual(utc.daily.map((d) => d.changes), [0, 0, 0, 1, 0, 2, 1], 'quiet days are present with 0');
  assert.deepEqual(utc.daily.map((d) => d.activePeople), [0, 0, 0, 1, 0, 2, 1]);

  // Pakistan is UTC+5: 21:40Z on the 2nd is 02:40 on the 3rd, 09:20Z is 14:20 the same day.
  const pk = await getAnalytics(store, BOARD, { now: NOW, days: 7, tz: 300 });
  assert.deepEqual(pk.daily.map((d) => d.changes), [0, 0, 0, 0, 1, 2, 1]);
  // India is UTC+5:30 and Nepal UTC+5:45: not whole hours, still exact.
  assert.equal(localDate(D('2026-03-02T18:40:00Z'), 330), '2026-03-03');
  assert.equal(localDate(D('2026-03-02T18:15:00Z'), 345), '2026-03-03', '18:15Z is exactly midnight in UTC+5:45');
  assert.equal(localDate(D('2026-03-02T18:15:00Z'), 330), '2026-03-02', 'but only 23:45 in UTC+5:30');
});

test('busiest hours rotate with the timezone and always add up to the same total', async () => {
  const store = await fixtureStore();
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const utc = await getAnalytics(store, BOARD, { now: NOW, tz: 0 });
  assert.equal(utc.hours.length, 24);
  assert.equal(utc.hours[21], 1, '21:40Z');
  assert.equal(utc.hours[8], 2, '08:00Z (two changes at that moment)');
  assert.equal(utc.hours[9], 1, '09:20Z');
  const pk = await getAnalytics(store, BOARD, { now: NOW, tz: 300 });
  assert.equal(pk.hours[2], 1, '21:40Z is 02:40 in UTC+5');
  assert.equal(pk.hours[13], 2, '08:00Z is 13:00');
  assert.equal(pk.hours[14], 1, '09:20Z is 14:20');
  const west = await getAnalytics(store, BOARD, { now: NOW, tz: -480 });
  assert.equal(west.hours[13], 1, '21:40Z is 13:40 in UTC-8');
  assert.equal(west.hours[0], 2, '08:00Z is 00:00 in UTC-8');
  assert.equal(west.hours[1], 1, '09:20Z is 01:20 in UTC-8');
  for (const r of [utc, pk, west]) assert.equal(sum(r.hours), 4);
  const india = await getAnalytics(store, BOARD, { now: NOW, tz: 330 });
  assert.equal(india.hours[3], 1, '21:40Z is 03:10 in UTC+5:30');
  assert.equal(india.hours[13], 2, '08:00Z is 13:30');
  assert.equal(india.hours[14], 1, '09:20Z is 14:50');
});

test('sessions: counted per local start day and summed; an open session is measured up to now', async () => {
  const store = await fixtureStore();
  const mk = (start, end) => store.createSession({ boardId: BOARD, startedAt: new Date(start), startSequence: 0 }).then(async (s) => { if (end) await store.endSession(s.id, { endedAt: new Date(end), endReason: 'idle', endSequence: 0, eventCount: 0, lastEventAt: null }); });
  await mk(D('2026-03-04T08:00:00Z'), D('2026-03-04T08:30:00Z')); // 30 min
  await mk(D('2026-03-04T20:00:00Z'), D('2026-03-04T21:00:00Z')); // 60 min; on the 5th in UTC+5
  await mk(D('2026-03-05T11:00:00Z'), null); // still open at NOW (12:00): 60 min
  await mk(D('2025-12-01T10:00:00Z'), D('2025-12-01T10:10:00Z')); // old: counts in totals, not in the 7-day chart
  const r = await getAnalytics(store, BOARD, { now: NOW, days: 7, tz: 0 });
  assert.equal(r.totals.sessions, 4);
  assert.equal(r.totals.sessionMs, (30 + 60 + 60 + 10) * 60_000);
  assert.deepEqual(r.daily.map((d) => d.sessions), [0, 0, 0, 0, 0, 2, 1]);
  const pk = await getAnalytics(store, BOARD, { now: NOW, days: 7, tz: 300 });
  assert.deepEqual(pk.daily.map((d) => d.sessions), [0, 0, 0, 0, 0, 1, 2], 'the 20:00Z session is already the 5th in UTC+5');
});

test('an empty board yields a complete, honest, all-zero result', async () => {
  const store = newStore();
  const r = await getAnalytics(store, BOARD, { now: NOW, days: 14 });
  assert.equal(r.totals.changes, 0);
  assert.equal(r.totals.firstChangeAt, null);
  assert.deepEqual(r.users, []);
  assert.equal(r.daily.length, 14);
  assert.ok(r.daily.every((d) => d.changes === 0 && d.sessions === 0 && d.activePeople === 0));
  assert.deepEqual(r.hours, new Array(24).fill(0));
  assert.deepEqual(r.heatmap.cells, []);
  assert.equal(r.heatmap.bounds, null);
});

test('heatmap bounds cover the located cells; unplaceable changes are reported, not hidden', async () => {
  const store = newStore();
  await seed(store, [
    [...make('a', 'rect', 0, 0), T.mid],         // centre (50,50)   -> 0,0
    [...make('b', 'rect', 950, -250), T.mid],     // centre (1000,-200) -> 10,-2
    ['object:updated', 'nope', { patch: { left: 1 } }, ADA, T.mid],
  ]);
  const { heatmap } = await getAnalytics(store, BOARD, { now: NOW });
  assert.deepEqual(heatmap.bounds, { minX: 0, maxX: 10, minY: -2, maxY: 0 });
  assert.equal(heatmap.located, 2);
  assert.equal(heatmap.unlocated, 1);
});

test('unknown board -> 404', async () => {
  const store = newStore();
  store.missingBoards.add(BOARD);
  await assert.rejects(getAnalytics(store, BOARD, { now: NOW }), { status: 404 });
});

test('caching: unchanged board is not re-read; a changed one is rebuilt once it is stale; the daily rebuild and version bump invalidate', async () => {
  const store = await fixtureStore();
  await getAnalytics(store, BOARD, { now: NOW });
  const reads = store.analyticsReads;
  assert.ok(reads >= 1);
  await getAnalytics(store, BOARD, { now: NOW + 1000 });
  await getAnalytics(store, BOARD, { now: NOW + 2000, tz: 300, days: 14 });
  assert.equal(store.analyticsReads, reads, 'same sequence: served from the cache, whatever the tz/window');

  await seed(store, [[...make('x', 'rect', 0, 0), NOW]]);
  const fresh = await getAnalytics(store, BOARD, { now: NOW + 1000, maxStaleMs: 5000 });
  assert.equal(store.analyticsReads, reads, 'a change within the staleness allowance does not trigger a rebuild');
  assert.equal(fresh.totals.changes, 4);
  assert.equal(fresh.asOf.stale, true, 'and the response says it is slightly behind');

  const caughtUp = await getAnalytics(store, BOARD, { now: NOW + 60_000, maxStaleMs: 5000 });
  assert.ok(store.analyticsReads > reads, 'once stale, it is rebuilt');
  assert.equal(caughtUp.totals.changes, 5);
  assert.equal(caughtUp.asOf.stale, false);
  assert.equal(caughtUp.asOf.sequence, 5);

  const before = store.analyticsReads;
  await getAnalytics(store, BOARD, { now: NOW + 60_000 + 25 * 3600_000 });
  assert.ok(store.analyticsReads > before, 'an unchanged board is still rebuilt after a day (the time series is windowed from "now")');

  const agg = store.aggregates.get(BOARD);
  agg.version = ANALYTICS_VERSION - 1;
  const b2 = store.analyticsReads;
  await getAnalytics(store, BOARD, { now: NOW + 60_000 + 25 * 3600_000 + 1 });
  assert.ok(store.analyticsReads > b2, 'a cache written by older maths is discarded');
});

test('concurrent requests share one rebuild', async () => {
  const store = await fixtureStore();
  await Promise.all([1, 2, 3, 4, 5].map(() => getAnalytics(store, BOARD, { now: NOW })));
  assert.equal(store.analyticsReads, 1, 'five simultaneous requests, one pass over the events');
});

test('long histories are read in pages and still add up exactly', async () => {
  const store = newStore();
  const batchSize = 1000;
  for (let i = 0; i < 12; i++) {
    const start = await store.allocateSequence(BOARD, batchSize);
    await store.insertEvents(Array.from({ length: batchSize }, (_, j) => ({
      boardId: BOARD, sequence: start + j, type: 'object:created', objectId: `o${i}-${j}`, userId: ADA, createdAt: new Date(T.mid + j),
      payload: { object: { id: `o${i}-${j}`, kind: 'rect', left: (j % 50) * 100, top: i * 100, width: 0, height: 0 } },
    })));
  }
  const r = await getAnalytics(store, BOARD, { now: NOW });
  assert.equal(r.totals.changes, 12_000);
  assert.equal(store.analyticsReads, 3, '12,000 events = 3 pages of 5,000');
  assert.equal(r.heatmap.located, 12_000);
  assert.equal(r.users[0].changes, 12_000);
  assert.equal(r.hours.reduce((a, b) => a + b, 0), 12_000);
});

test('events recorded by real clients over real sockets show up with the right numbers', async () => {
  const srv = await startServer({ options: { sessionGraceMs: 50 } });
  try {
    const ada = await srv.connect('ada');
    const bob = await srv.connect('bob');
    await emit(ada, 'board:join', { boardId: BOARD });
    await emit(bob, 'board:join', { boardId: BOARD });
    const rectAt = (id, left, top) => create(id, { left, top, width: 100, height: 100 });
    await emit(ada, 'ops:submit', batch([rectAt('p', 0, 0), rectAt('q', 600, 0)]));
    await emit(bob, 'ops:submit', batch([rectAt('r', 0, 600), { type: 'object:updated', id: 'p', patch: { fill: '#000' } }]));
    await emit(ada, 'ops:submit', batch([{ type: 'object:deleted', id: 'q' }]));
    ada.close(); bob.close();
    await quiet(250);

    const r = await getAnalytics(srv.store, BOARD, { now: Date.now() + 1000 });
    assert.equal(r.totals.changes, 5);
    assert.deepEqual(r.opsByType.map((o) => o.count), [3, 1, 1, 0]);
    assert.deepEqual(r.users.map((u) => [u.name, u.changes]), [['Ada', 3], ['Bob', 2]]);
    assert.equal(r.totals.sessions, 1);
    assert.equal(r.daily.at(-1).sessions + r.daily.at(-2).sessions >= 1, true);
    const cell = (x, y) => r.heatmap.cells.find((c) => c[0] === x && c[1] === y)?.[2];
    assert.equal(cell(0, 0), 2, 'p: created, then recoloured by Bob');
    assert.equal(cell(6, 0), 2, 'q: created, then deleted');
    assert.equal(cell(0, 6), 1, 'r');
  } finally {
    await srv.close();
  }
});
