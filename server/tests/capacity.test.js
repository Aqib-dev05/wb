import assert from 'node:assert/strict';
import { test } from 'node:test';
import mongoose from 'mongoose';
import { bsonSize } from '../src/services/bsonSize.js';
import { BoardState, OP } from '../src/services/boardState.js';
import { BOARD, batch, create, emit, quiet, rect, startServer } from './helpers/harness.js';

const { calculateObjectSize } = mongoose.mongo.BSON;

const pen = (id, points) => ({ id, type: 'Path', kind: 'pen', left: 1.5, top: -20, width: 300, height: 200, stroke: '#000', strokeWidth: 2, fill: '', path: [['M', 0, 0], ...Array.from({ length: points }, (_, k) => ['L', +(k * 0.37).toFixed(2), +(Math.sin(k / 5) * 40).toFixed(2)])] });

test('bsonSize equals what the real BSON library reports', () => {
  const samples = [
    rect('a'),
    pen('p', 40),
    { id: 'é€😀', text: 'héllo wörld 😀', n: [0, -1, 2 ** 31 - 1, 2 ** 31, -(2 ** 31) - 1, 1.5, 1e21], t: true, f: false, z: null, nested: { a: { b: [[], {}, [1, [2]]] } }, empty: '' },
  ];
  for (const doc of samples) assert.equal(bsonSize(doc), calculateObjectSize(doc), JSON.stringify(doc).slice(0, 50));
});

test('BoardState.bytes follows create / update / delete exactly and matches a rebuild from scratch', () => {
  const s = new BoardState();
  const fresh = () => new BoardState(s.toObjects()).bytes;
  s.apply({ type: OP.CREATED, object: pen('p1', 100) });
  s.apply({ type: OP.CREATED, object: rect('r1') });
  assert.equal(s.bytes, fresh());
  s.apply({ type: OP.UPDATED, id: 'p1', patch: { path: pen('x', 300).path, stroke: '#ff0000', left: 5 } }); // grows, new value types
  s.apply({ type: OP.UPDATED, id: 'r1', patch: { rx: 4 } }); // new key
  assert.equal(s.bytes, fresh());
  s.apply({ type: OP.DELETED, id: 'p1' });
  assert.equal(s.bytes, fresh());
  s.apply({ type: OP.DELETED, id: 'r1' });
  assert.equal(s.bytes, 0);
});

test('the estimate tracks the real snapshot document size closely, including for stroke-heavy boards', () => {
  const objects = [...Array.from({ length: 300 }, (_, i) => pen(`p${i}`, 150)), ...Array.from({ length: 700 }, (_, i) => rect(`r${i}`))];
  const real = calculateObjectSize({ objects });
  const est = new BoardState(objects).bytes;
  assert.ok(Math.abs(est - real) / real < 0.01, `estimate ${est} vs real ${real}`);
});

test('plan refuses content past the limit but still allows shrinking, and counts the whole batch', () => {
  const one = BoardState.objectBytes(rect('x0'));
  const limit = one * 3 + 10;
  const s = new BoardState();
  const { accepted, rejected } = s.plan([create('a'), create('b'), create('c'), create('d')], { maxBytes: limit });
  assert.equal(accepted.length, 3);
  assert.deepEqual(rejected, [{ index: 3, reason: 'board_full' }]);
  accepted.forEach((op) => s.apply(op));

  // full: more content is refused, a delete is not, and its room can be used straight away in the same batch
  assert.deepEqual(s.plan([create('e')], { maxBytes: limit }).rejected.map((r) => r.reason), ['board_full']);
  const mixed = s.plan([{ type: OP.DELETED, id: 'a' }, create('e')], { maxBytes: limit });
  assert.equal(mixed.accepted.length, 2);
  // moving things around is never refused
  assert.equal(s.plan([{ type: OP.UPDATED, id: 'b', patch: { left: 99 } }, { type: OP.REORDERED, id: 'b', afterId: null }], { maxBytes: limit }).accepted.length, 2);
});

test('an update that grows an object past the limit is refused; one that shrinks it is accepted', () => {
  const s = new BoardState([pen('p', 50)]);
  const limit = s.bytes + 50;
  const grow = s.plan([{ type: OP.UPDATED, id: 'p', patch: { path: pen('p', 500).path } }], { maxBytes: limit });
  assert.deepEqual(grow.rejected, [{ index: 0, reason: 'board_full' }]);
  const shrink = s.plan([{ type: OP.UPDATED, id: 'p', patch: { path: pen('p', 5).path } }], { maxBytes: limit });
  assert.equal(shrink.accepted.length, 1);
});

test('without a limit nothing is ever refused (existing behaviour)', () => {
  const s = new BoardState();
  assert.equal(s.plan(Array.from({ length: 50 }, (_, i) => create(`o${i}`))).accepted.length, 50);
});

test('over the wire: a full board refuses new content with board_full, persists nothing for it, and recovers after a delete', async () => {
  const srv = await startServer({ options: { maxBoardBytes: BoardState.objectBytes(rect('o0')) * 2 + 20 } });
  try {
    const ada = await srv.connect('ada');
    await emit(ada, 'board:join', { boardId: BOARD });
    assert.equal((await emit(ada, 'ops:submit', batch([create('a'), create('b')]))).accepted, 2);
    const before = srv.store.events.length;
    const refused = await emit(ada, 'ops:submit', batch([create('c')]));
    assert.equal(refused.ok, true);
    assert.equal(refused.accepted, 0);
    assert.deepEqual(refused.rejected.map((r) => r.reason), ['board_full']);
    assert.equal(srv.store.events.length, before, 'a refused op is not recorded');
    assert.equal((await emit(ada, 'ops:submit', batch([{ type: 'object:deleted', id: 'a' }, create('c')]))).accepted, 2);
  } finally {
    await srv.close();
  }
});

test('a failing snapshot is retried with a back-off, not on every write', async () => {
  const srv = await startServer({ options: { snapshotEvery: 2, snapshotRetryMs: 150, idleFlushMs: 60_000 } });
  let attempts = 0;
  const original = srv.store.saveSnapshot;
  srv.store.saveSnapshot = async (...args) => {
    attempts += 1;
    throw new Error('document too large');
  };
  const quietErr = console.error;
  console.error = () => {};
  try {
    const ada = await srv.connect('ada');
    await emit(ada, 'board:join', { boardId: BOARD });
    for (let i = 0; i < 12; i++) await emit(ada, 'ops:submit', batch([create(`o${i}`)]));
    await quiet(30);
    assert.equal(attempts, 1, `12 writes right after a failure caused ${attempts} snapshot attempts`);
    await quiet(200); // back-off over
    srv.store.saveSnapshot = original;
    await emit(ada, 'ops:submit', batch([create('late')]));
    await quiet(40);
    assert.ok(srv.store.snapshots.length >= 1, 'snapshots resume once the store works and the back-off has passed');
  } finally {
    console.error = quietErr;
    await srv.close();
  }
});
