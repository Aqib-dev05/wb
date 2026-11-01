import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HEAT_CELL, HEAT_MAX_CELLS, QUARTER_MS, reduceEvents } from '../src/services/analytics.reducer.js';

// Hand-computed fixture. Times are fixed so every expected number below can be checked by eye.
const D = (iso) => +new Date(iso);
const T = {
  a: D('2026-03-02T09:05:00Z'), // quarter 09:00
  b: D('2026-03-02T09:14:59Z'), // same quarter
  c: D('2026-03-02T09:15:00Z'), // next quarter
  d: D('2026-03-02T21:40:00Z'),
  e: D('2026-03-03T00:10:00Z'), // next UTC day
};
const NOW = D('2026-03-05T12:00:00Z');
const ADA = 'u-ada';
const BOB = 'u-bob';
let seq = 0;
const ev = (type, objectId, payload, userId, at) => ({ sequence: ++seq, type, objectId, payload, userId, createdAt: new Date(at) });
const created = (id, obj, userId, at) => ev('object:created', id, { object: { id, ...obj } }, userId, at);
const updated = (id, patch, userId, at) => ev('object:updated', id, { patch }, userId, at);
const deleted = (id, userId, at) => ev('object:deleted', id, {}, userId, at);
const reordered = (id, userId, at) => ev('object:reordered', id, { afterId: null }, userId, at);

const FIXTURE = () => {
  seq = 0;
  return [
    created('r1', { kind: 'rect', left: 10, top: 20, width: 100, height: 60 }, ADA, T.a),          // centre (60,50)  -> cell 0,0
    created('s1', { kind: 'sticky', left: 450, top: 50, width: 200, height: 200 }, BOB, T.b),      // centre (550,150) -> cell 5,1
    updated('r1', { fill: '#f00' }, ADA, T.c),                                                      // style change: located by remembered geometry -> cell 0,0
    updated('r1', { left: 310 }, ADA, T.d),                                                         // moved: centre (360,50) -> cell 3,0
    reordered('s1', BOB, T.d),                                                                      // cell 5,1
    deleted('s1', BOB, T.e),                                                                        // cell 5,1, then forgotten
    updated('ghost', { left: 5 }, ADA, T.e),                                                        // object never seen: counted, but cannot be located
  ];
};

test('counts changes by type, by kind created and by person', () => {
  const r = reduceEvents(FIXTURE(), NOW);
  assert.equal(r.events, 7);
  assert.deepEqual(r.byType, { created: 2, updated: 3, deleted: 1, reordered: 1 });
  assert.deepEqual(r.byKind, [{ kind: 'rect', count: 1 }, { kind: 'sticky', count: 1 }]);
  const ada = r.users.find((u) => u.id === ADA);
  const bob = r.users.find((u) => u.id === BOB);
  assert.deepEqual([ada.created, ada.updated, ada.deleted, ada.reordered], [1, 3, 0, 0]);
  assert.deepEqual([bob.created, bob.updated, bob.deleted, bob.reordered], [1, 0, 1, 1]);
  assert.equal(ada.firstAt, T.a);
  assert.equal(ada.lastAt, T.e);
  assert.deepEqual(r.users.map((u) => u.id), [ADA, BOB], 'ranked by number of changes (4 vs 3)');
  assert.equal(r.firstAt, T.a);
  assert.equal(r.lastAt, T.e);
  assert.equal(r.lastSequence, 7);
});

test('time buckets are 15 minutes and remember who was active in them', () => {
  const r = reduceEvents(FIXTURE(), NOW);
  const bucket = (t) => r.series.find((b) => b.q === Math.floor(t / QUARTER_MS));
  assert.deepEqual(bucket(T.a), { q: Math.floor(T.a / QUARTER_MS), n: 2, u: [ADA, BOB] }, '09:05 and 09:14:59 share a bucket');
  assert.equal(bucket(T.c).n, 1, '09:15:00 starts the next bucket');
  assert.equal(bucket(T.d).n, 2);
  assert.deepEqual(bucket(T.d).u, [ADA, BOB]);
  assert.equal(r.series.reduce((s, b) => s + b.n, 0), 7, 'buckets add up to every event');
  assert.deepEqual(r.series.map((b) => b.q), [...r.series.map((b) => b.q)].sort((x, y) => x - y), 'ascending');
});

test('hour-of-day slots cover the whole history in UTC quarter-hours', () => {
  const r = reduceEvents(FIXTURE(), NOW);
  assert.equal(r.slots.length, 96);
  assert.equal(r.slots.reduce((a, b) => a + b, 0), 7);
  assert.equal(r.slots[9 * 4], 2, '09:00-09:14');
  assert.equal(r.slots[9 * 4 + 1], 1, '09:15-09:29');
  assert.equal(r.slots[21 * 4 + 2], 2, '21:30-21:44');
  assert.equal(r.slots[0], 2, '00:10 falls in the first slot of the day (00:00-00:14)');
  assert.equal(r.slots[1], 0);
});

test('the heatmap locates every change by the object it touched, including style changes and deletes', () => {
  const r = reduceEvents(FIXTURE(), NOW);
  assert.equal(r.heat.cellSize, HEAT_CELL);
  assert.equal(r.heat.located, 6);
  assert.equal(r.heat.unlocated, 1, 'the update to an object we never saw cannot be placed');
  const cell = (x, y) => r.heat.cells.find((c) => c[0] === x && c[1] === y)?.[2];
  assert.equal(cell(0, 0), 2, 'create + colour change of r1');
  assert.equal(cell(3, 0), 1, 'r1 after it moved');
  assert.equal(cell(5, 1), 3, 'create + reorder + delete of s1');
  assert.equal(r.heat.cells.length, 3);
  assert.deepEqual(r.heat.cells[0], [5, 1, 3], 'busiest cell first');
  assert.equal(r.heat.shown, 6);
  assert.equal(r.heat.hidden, 0);
});

test('origin and scale are respected when finding an object centre', () => {
  seq = 0;
  const r = reduceEvents(
    [
      created('c', { kind: 'ellipse', left: 500, top: 500, width: 100, height: 100, scaleX: 2, scaleY: 1, originX: 'center', originY: 'center' }, ADA, T.a), // centre = left/top -> cell 5,5
      created('s', { kind: 'rect', left: 0, top: 0, width: 100, height: 100, scaleX: 2, scaleY: 2 }, ADA, T.a), // top-left origin, 200x200 -> centre (100,100) -> cell 1,1
      updated('s', { scaleX: 4 }, ADA, T.b), // 400 wide -> centre (200,100) -> cell 2,1
    ],
    NOW
  );
  const cells = Object.fromEntries(r.heat.cells.map(([x, y, n]) => [`${x},${y}`, n]));
  assert.deepEqual(cells, { '5,5': 1, '1,1': 1, '2,1': 1 });
});

test('negative coordinates fall in negative cells (floor, not truncation)', () => {
  seq = 0;
  const r = reduceEvents([created('n', { kind: 'rect', left: -150, top: -20, width: 100, height: 0 }, ADA, T.a)], NOW); // centre (-100,-20) -> cell -1,-1
  assert.deepEqual(r.heat.cells, [[-1, -1, 1]]);
});

test('the time series only keeps the last 90 days, but totals keep everything', () => {
  seq = 0;
  const old = NOW - 100 * 24 * 3600 * 1000;
  const r = reduceEvents([created('o', { kind: 'rect', left: 0, top: 0 }, ADA, old), created('n', { kind: 'rect', left: 0, top: 0 }, ADA, NOW - 3600_000)], NOW);
  assert.equal(r.events, 2);
  assert.equal(r.series.length, 1);
  assert.equal(r.series[0].n, 1);
  assert.equal(r.slots.reduce((a, b) => a + b, 0), 2);
});

test('a huge heatmap keeps the busiest cells and accounts for the rest', () => {
  seq = 0;
  const events = [];
  for (let i = 0; i < HEAT_MAX_CELLS + 50; i++) events.push(created(`o${i}`, { kind: 'rect', left: i * HEAT_CELL, top: 0, width: 0, height: 0 }, ADA, T.a));
  for (let i = 0; i < 3; i++) events.push(updated('o7', { fill: '#fff' }, ADA, T.b)); // cell 7 is the busiest (4)
  const r = reduceEvents(events, NOW);
  assert.equal(r.heat.cells.length, HEAT_MAX_CELLS);
  assert.deepEqual(r.heat.cells[0], [7, 0, 4]);
  assert.equal(r.heat.located, HEAT_MAX_CELLS + 50 + 3);
  assert.equal(r.heat.shown + r.heat.hidden, r.heat.located, 'nothing disappears: shown + hidden = all located changes');
  assert.equal(r.heat.hidden, 50);
});

test('unknown event types, bad timestamps and garbage positions are ignored, never thrown on', () => {
  seq = 0;
  const r = reduceEvents(
    [
      ev('something:else', 'x', {}, ADA, T.a),
      { sequence: 99, type: 'object:created', objectId: 'bad', payload: { object: { id: 'bad', left: 1, top: 1 } }, userId: ADA, createdAt: 'nope' },
      created('nan', { kind: 'rect', left: NaN, top: Infinity, width: 'wide' }, ADA, T.a),
      created('str', { kind: 'rect', left: '10', top: '10' }, ADA, T.a),
    ],
    NOW
  );
  assert.equal(r.events, 2, 'only the two well-formed events count');
  assert.equal(r.heat.located, 0);
  assert.equal(r.heat.unlocated, 2);
});

test('the result is plain JSON: it survives a database round trip unchanged', () => {
  const r = reduceEvents(FIXTURE(), NOW);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.deepEqual(reduceEvents(FIXTURE(), NOW), r, 'deterministic');
});
