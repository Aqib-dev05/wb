import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { RoomManager } from '../src/services/room.service.js';
import { BOARD, batch, create, emit, once, quiet, rect, startServer } from './helpers/harness.js';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

const join = (socket, extra = {}) => emit(socket, 'board:join', { boardId: BOARD, ...extra });
const submit = (socket, ops) => emit(socket, 'ops:submit', batch(ops));

test('rejects missing, invalid and expired tokens at the handshake', async () => {
  await assert.rejects(srv.connect('x', undefined), /UNAUTHORIZED/);
  await assert.rejects(srv.connect('x', 'garbage'), /UNAUTHORIZED/);
  await assert.rejects(srv.connect('x', 'expired'), /TOKEN_EXPIRED/);
});

test('non-members cannot join; malformed requests are refused', async () => {
  const eve = await srv.connect('eve');
  assert.equal((await join(eve)).code, 'FORBIDDEN');
  assert.equal((await emit(eve, 'board:join', { boardId: 'nope' })).code, 'BAD_REQUEST');
  const ack = await submit(eve, [create('x')]);
  assert.equal(ack.code, 'NOT_JOINED', 'cannot write to a board you have not joined');
});

test('join returns state and role; presence is announced once per user', async () => {
  const ada = await srv.connect('ada');
  const a = await join(ada);
  assert.equal(a.ok, true);
  assert.equal(a.role, 'owner');
  assert.equal(a.mode, 'full');
  assert.deepEqual(a.participants.map((p) => p.name), ['Ada']);

  const joined = once(ada, 'user:joined');
  const bob = await srv.connect('bob');
  const b = await join(bob);
  assert.equal(b.role, 'editor');
  assert.deepEqual(b.participants.map((p) => p.name).sort(), ['Ada', 'Bob']);
  assert.equal((await joined).user.name, 'Bob');

  const left = once(ada, 'user:left');
  bob.close();
  assert.equal((await left).userId, b.you.id);
  ada.close();
});

test('operations get server sequence numbers, persist, and reach other clients in order', async () => {
  const ada = await srv.connect('ada');
  const bob = await srv.connect('bob');
  await join(ada); await join(bob);

  const got = once(bob, 'ops:applied');
  const ack = await submit(ada, [create('s1'), create('s2'), { type: 'object:updated', id: 's1', patch: { left: 40 } }]);
  assert.equal(ack.ok, true);
  assert.equal(ack.accepted, 3);
  assert.equal(ack.seqEnd - ack.seqStart, 2, 'consecutive sequence numbers for one batch');

  const msg = await got;
  assert.deepEqual(msg.ops.map((o) => o.seq), [ack.seqStart, ack.seqStart + 1, ack.seqStart + 2]);
  assert.equal(msg.userId, (await join(ada)).you.id);
  assert.equal(srv.store.events.filter((e) => e.sequence >= ack.seqStart).length, 3, 'events persisted');
  ada.close(); bob.close();
});

test('concurrent edits: every client sees the same order and the later sequence wins', async () => {
  const ada = await srv.connect('ada');
  const bob = await srv.connect('bob');
  await join(ada); await join(bob);
  await submit(ada, [create('c1')]);
  await quiet();

  const seenByAda = [], seenByBob = [];
  ada.on('ops:applied', (m) => seenByAda.push(...m.ops.map((o) => o.seq)));
  bob.on('ops:applied', (m) => seenByBob.push(...m.ops.map((o) => o.seq)));
  const [ra, rb] = await Promise.all([
    submit(ada, [{ type: 'object:updated', id: 'c1', patch: { left: 100, fill: 'red' } }]),
    submit(bob, [{ type: 'object:updated', id: 'c1', patch: { left: 200 } }]),
  ]);
  await quiet();
  assert.notEqual(ra.seqStart, rb.seqStart);
  const winner = ra.seqStart > rb.seqStart ? 100 : 200;
  const state = await srv.rooms.getState(BOARD);
  const c1 = state.objects.find((o) => o.id === 'c1');
  assert.equal(c1.left, winner, 'later sequence wins on the contested property');
  assert.equal(c1.fill, 'red', 'uncontested property from the other edit survives');
  assert.deepEqual(seenByAda, [rb.seqStart], 'each client receives only the other client\'s op');
  assert.deepEqual(seenByBob, [ra.seqStart]);
  ada.close(); bob.close();
});

test('delete wins over a concurrent update; the late update is rejected as gone', async () => {
  const ada = await srv.connect('ada');
  const bob = await srv.connect('bob');
  await join(ada); await join(bob);
  await submit(ada, [create('d1')]);
  await submit(ada, [{ type: 'object:deleted', id: 'd1' }]);
  const late = await submit(bob, [{ type: 'object:updated', id: 'd1', patch: { left: 9 } }]);
  assert.equal(late.accepted, 0);
  assert.deepEqual(late.rejected, [{ index: 0, reason: 'gone' }]);
  ada.close(); bob.close();
});

test('re-sent batches are idempotent (same batchId is not applied twice)', async () => {
  const ada = await srv.connect('ada');
  await join(ada);
  const payload = batch([create('i1')]);
  const first = await emit(ada, 'ops:submit', payload);
  const eventsBefore = srv.store.events.length;
  const again = await emit(ada, 'ops:submit', payload);
  assert.equal(again.duplicate, true);
  assert.equal(again.seqStart, first.seqStart);
  assert.equal(srv.store.events.length, eventsBefore, 'nothing new persisted');
  ada.close();
});

test('viewers can watch and send cursors but cannot change the board', async () => {
  const vic = await srv.connect('vic');
  const ada = await srv.connect('ada');
  await join(vic); await join(ada);
  assert.equal((await submit(vic, [create('v1')])).code, 'FORBIDDEN');
  const cursor = once(ada, 'cursor:moved');
  vic.emit('cursor:moved', { boardId: BOARD, x: 12, y: 34 });
  assert.deepEqual(await cursor, { boardId: BOARD, userId: (await join(vic)).you.id, x: 12, y: 34 });
  const transient = once(ada, 'object:transient', 300);
  vic.emit('object:transient', { boardId: BOARD, id: 'x', patch: { left: 1, top: 1 } });
  await assert.rejects(transient, /timeout/, 'viewer transient updates are not relayed');
  vic.close(); ada.close();
});

test('reconnect: a recent lastSeq yields a delta, an old one yields full state', async () => {
  const ada = await srv.connect('ada');
  let bob = await srv.connect('bob');
  await join(ada);
  const first = await join(bob);
  const lastSeq = first.sequence;
  bob.close();
  await quiet();
  await submit(ada, [create('r1'), create('r2')]);

  bob = await srv.connect('bob');
  const delta = await join(bob, { lastSeq });
  assert.equal(delta.mode, 'delta');
  assert.deepEqual(delta.ops.map((o) => o.object?.id), ['r1', 'r2']);
  assert.ok(delta.ops.every((o) => o.seq > lastSeq && o.userId));

  const none = await join(bob, { lastSeq: delta.sequence });
  assert.equal(none.mode, 'delta');
  assert.equal(none.ops.length, 0, 'up to date: empty delta');

  const stale = await join(bob, { lastSeq: delta.sequence + 1000 });
  assert.equal(stale.mode, 'full', 'unknown sequence falls back to full state');
  ada.close(); bob.close();
});

test('rejoin reports which pending batches the server already has', async () => {
  const ada = await srv.connect('ada');
  await join(ada);
  const sent = batch([create('k1')]);
  await emit(ada, 'ops:submit', sent);
  const rejoin = await join(ada, { pendingBatchIds: [sent.batchId, 'never-sent'] });
  assert.deepEqual(rejoin.knownBatchIds, [sent.batchId]);
  ada.close();
});

test('a failed write is reported, nothing is broadcast, and later writes still work', async () => {
  const ada = await srv.connect('ada');
  const bob = await srv.connect('bob');
  await join(ada); await join(bob);
  let leaked = false;
  bob.on('ops:applied', () => { leaked = true; });
  srv.store.failNextInsert = true;
  const failed = await submit(ada, [create('f1')]);
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'PERSIST_FAILED');
  await quiet();
  assert.equal(leaked, false);
  assert.equal((await srv.rooms.getState(BOARD)).objects.some((o) => o.id === 'f1'), false, 'state not changed by failed write');

  const next = once(bob, 'ops:applied');
  const ok = await submit(ada, [create('f1')]);
  assert.equal(ok.ok, true);
  const msg = await next;
  assert.ok(msg.ops[0].seq > msg.prev, 'broadcast carries prev so clients can detect missed batches');
  ada.close(); bob.close();
});

test('kicking a user removes live access immediately', async () => {
  const bob = await srv.connect('bob');
  const ada = await srv.connect('ada');
  await join(bob); await join(ada);
  const kicked = once(bob, 'board:kicked');
  await srv.realtime.kickUser(BOARD, (await join(bob)).you.id);
  assert.equal((await kicked).boardId, BOARD);
  const ack = await submit(bob, [create('after-kick')]);
  assert.equal(ack.code, 'NOT_JOINED', 'a kicked socket can no longer write');
  bob.close(); ada.close();
});

test('role downgrade takes effect on the next operation', async () => {
  const bob = await srv.connect('bob');
  const info = await join(bob);
  assert.equal((await submit(bob, [create('p1')])).ok, true);
  await srv.realtime.setRole(BOARD, info.you.id, 'viewer');
  assert.equal((await submit(bob, [create('p2')])).code, 'FORBIDDEN');
  bob.close();
});

test('server restart: state is rebuilt from snapshot + later events, never from scratch', async () => {
  const store = (await import('./helpers/memoryStore.js')).createMemoryStore();
  const s1 = await startServer({ store, options: { snapshotEvery: 5 } });
  const ada = await s1.connect('ada');
  await emit(ada, 'board:join', { boardId: BOARD });
  for (let i = 0; i < 8; i++) await emit(ada, 'ops:submit', batch([create(`o${i}`)]));
  await emit(ada, 'ops:submit', batch([{ type: 'object:deleted', id: 'o0' }, { type: 'object:updated', id: 'o7', patch: { left: 77 } }]));
  await quiet();
  assert.ok(store.snapshots.length >= 1, 'a periodic snapshot was written');
  const expected = (await s1.rooms.getState(BOARD)).objects;
  ada.close(); await s1.close();

  const fresh = new RoomManager(store);
  const recovered = await fresh.getState(BOARD);
  assert.deepEqual(recovered.objects, expected);
  assert.equal(recovered.sequence, 9 + 1);
  const snap = store.snapshots.at(-1);
  assert.ok(store.events.filter((e) => e.sequence > snap.sequence).length < store.events.length, 'only events after the snapshot are replayed');
});
