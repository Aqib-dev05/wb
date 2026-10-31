import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardState, eventToOp } from '../src/services/boardState.js';
import * as playback from '../src/services/playback.service.js';
import { BOARD, USERS, batch, create, emit, quiet, startServer } from './helpers/harness.js';

const join = (socket) => emit(socket, 'board:join', { boardId: BOARD });
const submit = (socket, ops) => emit(socket, 'ops:submit', batch(ops));
const withServer = (options, fn) => async () => {
  const srv = await startServer({ options });
  try {
    await fn(srv);
  } finally {
    await srv.close();
  }
};

test('a session starts on the first join, records arrivals and departures, and ends after the grace period', withServer({ sessionGraceMs: 80 }, async (srv) => {
  const { sessions, participants, events } = srv.store;
  const ada = await srv.connect('ada');
  await join(ada);
  await quiet(20);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].endedAt, null, 'open while someone is on the board');
  assert.equal(sessions[0].startSequence, 0);

  assert.equal((await submit(ada, [create('a'), create('b')])).accepted, 2);
  const bob = await srv.connect('bob');
  await join(bob);
  await quiet(20);
  bob.close();
  await quiet(40);

  assert.equal(sessions.length, 1, 'a second person does not start a second session');
  assert.deepEqual(participants.map((p) => [p.userId, p.leftAt !== null]), [[USERS.ada.id, false], [USERS.bob.id, true]]);
  assert.ok(events.every((e) => e.sessionId === sessions[0].id), 'every recorded event carries the session id');

  ada.close();
  await quiet(250); // grace (80ms) + bookkeeping
  const s = sessions[0];
  assert.ok(s.endedAt, 'session ended');
  assert.equal(s.endReason, 'idle');
  assert.equal(s.eventCount, 2);
  assert.equal(s.endSequence, 2);
  assert.ok(participants.every((p) => p.leftAt), 'everyone has a leave time');
  const adaRow = participants.find((p) => p.userId === USERS.ada.id);
  assert.equal(+adaRow.leftAt, +s.endedAt, 'the session ends when the last person left, not when the grace period expired');
}));

test('coming back within the grace period continues the session; after it, a new one starts', withServer({ sessionGraceMs: 200 }, async (srv) => {
  const { sessions, participants } = srv.store;
  const ada = await srv.connect('ada');
  await join(ada);
  await submit(ada, [create('a')]);
  ada.close();
  await quiet(40);

  const again = await srv.connect('ada');
  await join(again);
  await quiet(40);
  assert.equal(sessions.length, 1, 'a reconnect blip is the same session');
  assert.equal(sessions[0].endedAt, null);
  assert.equal(participants.length, 2, 'but both stretches of presence are recorded');

  again.close();
  await quiet(350);
  assert.ok(sessions[0].endedAt);

  const later = await srv.connect('bob');
  await join(later);
  await quiet(30);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].startSequence, sessions[0].endSequence, 'the new session starts from where the last one ended');
}));

test('playback state at every sequence equals a from-scratch replay, and uses snapshots to get there', withServer({ sessionGraceMs: 60, snapshotEvery: 3, idleFlushMs: 20 }, async (srv) => {
  const ada = await srv.connect('ada');
  await join(ada);
  const script = [
    [create('a')], [create('b', { left: 100 })], [{ type: 'object:updated', id: 'a', patch: { left: 40, fill: '#f00' } }],
    [create('c', {}, 'a')], [{ type: 'object:reordered', id: 'a', afterId: 'c' }], [{ type: 'object:deleted', id: 'b' }],
    [create('d')], [{ type: 'object:updated', id: 'd', patch: { top: 9 } }], [{ type: 'object:updated', id: 'c', patch: { opacity: 0.5 } }],
    [create('e')], [{ type: 'object:deleted', id: 'a' }],
    [create('z', {}, null)], // created at the very bottom of the stack
  ];
  for (const ops of script) assert.equal((await submit(ada, ops)).ok, true);
  await quiet(120);
  assert.ok(srv.store.snapshots.length >= 2, 'periodic snapshots were taken');

  const all = [...srv.store.events].sort((x, y) => x.sequence - y.sequence);
  const naive = new BoardState([], 0);
  let usedSnapshot = 0;
  for (let n = 0; n <= all.length; n++) {
    if (n > 0) naive.apply(eventToOp(all[n - 1]));
    const got = await playback.stateAtSequence(srv.store, BOARD, n);
    assert.deepEqual(got.objects, naive.toObjects(), `state after sequence ${n}`);
    if (got.snapshotSequence > 0) {
      usedSnapshot++;
      assert.ok(got.replayed <= 3, 'only the events after the snapshot are replayed');
    }
  }
  assert.ok(usedSnapshot > 0, 'at least one lookup started from a snapshot');

  // The replayed end state must also equal what the live room holds (z-order included), not just
  // what the replay code itself produces.
  const live = (await srv.rooms.getRoom(BOARD)).state.toObjects();
  const replayed = (await playback.stateAtSequence(srv.store, BOARD, all.length)).objects;
  assert.deepEqual(replayed.map((o) => o.id), live.map((o) => o.id), 'same objects in the same stacking order as the live board');
  assert.equal(live[0].id, 'z', 'sanity: the bottom-created object really is at the bottom live');
}));

test('history reads never modify the stored snapshots', withServer({ sessionGraceMs: 60, snapshotEvery: 2 }, async (srv) => {
  const ada = await srv.connect('ada');
  await join(ada);
  await submit(ada, [create('a'), create('b')]);
  await quiet(60);
  await submit(ada, [{ type: 'object:updated', id: 'a', patch: { left: 500 } }]);
  const before = structuredClone(srv.store.snapshots);
  const total = srv.store.events.length;
  await playback.stateAtSequence(srv.store, BOARD, total);
  assert.deepEqual(srv.store.snapshots, before);
}));

test('session history: listing, presence, paging and seeking by time (deterministic clock)', withServer({ sessionGraceMs: 60 }, async (srv) => {
  const { sessions, participants, events } = srv.store;
  const ada = await srv.connect('ada');
  await join(ada);
  for (const ops of [[create('a')], [create('b')], [{ type: 'object:updated', id: 'a', patch: { left: 50 } }], [{ type: 'object:deleted', id: 'b' }], [create('c')]]) await submit(ada, ops);
  ada.close();
  await quiet(200);

  // Replace wall-clock times with a fixed timeline: session 0..10s, events at 1s,2s,3s,4s,5s.
  const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
  sessions[0].startedAt = new Date(T0);
  sessions[0].endedAt = new Date(T0 + 10_000);
  participants[0].joinedAt = new Date(T0);
  participants[0].leftAt = new Date(T0 + 10_000);
  [...events].sort((a, b) => a.sequence - b.sequence).forEach((e, i) => { e.createdAt = new Date(T0 + (i + 1) * 1000); });
  const sid = sessions[0].id;

  // a session in which nobody changed anything: hidden by default
  const bob = await srv.connect('bob');
  await join(bob);
  bob.close();
  await quiet(200);
  assert.equal(sessions.length, 2);

  const list = await playback.listSessions(srv.store, BOARD);
  assert.equal(list.meta.total, 1, 'the empty session is hidden');
  assert.equal((await playback.listSessions(srv.store, BOARD, { includeEmpty: true })).meta.total, 2);
  const [item] = list.items;
  assert.equal(item.durationMs, 10_000);
  assert.equal(item.eventCount, 5);
  assert.equal(item.live, false);
  assert.deepEqual(item.participants.map((p) => p.name), ['Ada']);

  const detail = await playback.getSession(srv.store, BOARD, sid);
  assert.deepEqual(detail.presence.map((p) => [p.name, p.joinedMs, p.leftMs]), [['Ada', 0, 10_000]]);

  const p1 = await playback.listSessionEvents(srv.store, BOARD, sid, { after: 0, limit: 2 });
  assert.deepEqual(p1.events.map((e) => e.seq), [1, 2]);
  assert.equal(p1.hasMore, true);
  assert.equal(p1.nextAfter, 2);
  assert.equal(p1.events[0].type, 'object:created');
  assert.equal(p1.events[0].at, T0 + 1000);
  assert.equal(p1.events[0].userId, USERS.ada.id);
  const p2 = await playback.listSessionEvents(srv.store, BOARD, sid, { after: p1.nextAfter, limit: 2 });
  assert.deepEqual(p2.events.map((e) => e.seq), [3, 4]);
  const p3 = await playback.listSessionEvents(srv.store, BOARD, sid, { after: p2.nextAfter, limit: 2 });
  assert.deepEqual(p3.events.map((e) => e.seq), [5]);
  assert.equal(p3.hasMore, false);

  const at = (ms) => playback.stateAtOffset(srv.store, BOARD, sid, ms);
  const ids = (s) => s.objects.map((o) => o.id);
  assert.deepEqual([(await at(0)).sequence, ids(await at(0))], [0, []], 'start of the session');
  assert.deepEqual([(await at(999)).sequence, ids(await at(999))], [0, []], 'just before the first change');
  const mid = await at(2500);
  assert.deepEqual([mid.sequence, mid.offsetMs, ids(mid)], [2, 2000, ['a', 'b']]);
  assert.equal((await at(3000)).sequence, 3, 'a change exactly at the requested moment is included');
  assert.equal((await at(3000)).objects[0].left, 50);
  const end = await at(10_000);
  assert.deepEqual([end.sequence, ids(end)], [5, ['a', 'c']]);
  assert.equal((await at(999_999)).sequence, 5, 'offsets past the end are clamped');
  assert.equal((await at(-5)).sequence, 0, 'negative offsets are clamped');

  await assert.rejects(playback.getSession(srv.store, BOARD, 'f'.repeat(24)), { status: 404 });
  await assert.rejects(playback.getSession(srv.store, '507f1f77bcf86cd799439099', sid), { status: 404 }, 'a session is only visible under its own board');
}));

test('startup recovery closes sessions a crash left open, using the last recorded activity', withServer({ sessionGraceMs: 5_000 }, async (srv) => {
  const ada = await srv.connect('ada');
  await join(ada);
  await submit(ada, [create('a'), create('b')]);
  await quiet(20);
  const { sessions, participants } = srv.store;
  assert.equal(sessions[0].endedAt, null);

  assert.equal(await srv.store.recoverOpenSessions(), 1);
  const lastEvent = Math.max(...srv.store.events.map((e) => +e.createdAt));
  assert.equal(sessions[0].endReason, 'recovered');
  assert.equal(+sessions[0].endedAt, lastEvent);
  assert.equal(sessions[0].eventCount, 2);
  assert.equal(sessions[0].endSequence, 2);
  assert.ok(participants.every((p) => p.leftAt), 'open presence rows are closed too');
  assert.equal(await srv.store.recoverOpenSessions(), 0, 'idempotent');
}));

test('a failing session write never blocks editing: events are still saved, just untagged', withServer({ sessionGraceMs: 60 }, async (srv) => {
  srv.store.failNextSessionCreate = true;
  const log = console.error;
  console.error = () => {};
  try {
    const ada = await srv.connect('ada');
    assert.equal((await join(ada)).ok, true);
    const ack = await submit(ada, [create('a')]);
    assert.equal(ack.ok, true);
    assert.equal(ack.accepted, 1);
  } finally {
    console.error = log;
  }
  assert.equal(srv.store.sessions.length, 0);
  assert.equal(srv.store.events[0].sessionId, null);
}));
