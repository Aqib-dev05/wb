import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ShadowState } from '../src/canvas/shadow.js';
import { PlaybackEngine } from '../src/playback/PlaybackEngine.js';

const START = 1_700_000_000_000;
const DURATION = 10_000;
const obj = (id, extra = {}) => ({ id, type: 'Rect', kind: 'rect', left: 0, top: 0, ...extra });

// A recorded session: [seq, offset ms, op]
const RECORDING = [
  [1, 1000, { type: 'object:created', object: obj('a') }],
  [2, 2000, { type: 'object:created', object: obj('b') }],
  [3, 3000, { type: 'object:updated', id: 'a', patch: { left: 50 } }],
  [4, 4000, { type: 'object:deleted', id: 'b' }],
  [5, 5000, { type: 'object:created', object: obj('c') }],
  [6, 8000, { type: 'object:updated', id: 'c', patch: { top: 7 } }],
];
const toEvent = ([seq, t, op]) => ({ seq, at: START + t, userId: 'u1', ...op });

/** What the board looks like after every event recorded at or before `ms` (computed independently of the engine). */
function expectedAt(ms, recording = RECORDING) {
  const state = new ShadowState();
  for (const [, t, op] of recording) if (t <= ms) state.applyOp(structuredClone(op));
  return state.toObjects();
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/** Mimics the server API: state at a moment, and events in pages after a sequence. */
function makeSource({ recording = RECORDING, pageSize = 100 } = {}) {
  const source = {
    holdEvents: null, // a deferred: loadEvents waits for it
    delayNextState: null,
    failEvents: false,
    stateCalls: [],
    async loadState(ms) {
      const gate = this.delayNextState;
      this.delayNextState = null;
      this.stateCalls.push(ms);
      if (gate) await gate.promise;
      const last = [...recording].filter(([, t]) => t <= ms).at(-1);
      return { sequence: last ? last[0] : 0, objects: expectedAt(ms, recording) };
    },
    async loadEvents(after) {
      if (this.failEvents) throw new Error('network down');
      if (this.holdEvents) await this.holdEvents.promise;
      const rows = recording.filter(([seq]) => seq > after).map(toEvent);
      const events = rows.slice(0, pageSize);
      return { events, hasMore: rows.length > pageSize, nextAfter: events.length ? events.at(-1).seq : after };
    },
  };
  return source;
}

function makeView() {
  const view = {
    state: new ShadowState(),
    applied: [],
    resets: 0,
    async reset(objects) {
      view.resets++;
      view.state.reset(structuredClone(objects));
    },
    async apply(ops) {
      view.applied.push(...ops);
      for (const op of ops) view.state.applyOp(structuredClone(op));
    },
  };
  return view;
}

const flush = () => new Promise((r) => setImmediate(r));

/** A requestAnimationFrame stand-in we step by hand. */
function makeClock() {
  let t = 0;
  let pending = null;
  let id = 0;
  return {
    now: () => t,
    request(fn) {
      pending = fn;
      return ++id;
    },
    cancel() {
      pending = null;
    },
    async advance(ms, step = 16) {
      let left = ms;
      while (left > 0) {
        const d = Math.min(step, left);
        t += d;
        left -= d;
        const fn = pending;
        pending = null;
        if (fn) fn();
        await flush();
      }
    },
  };
}

async function setup({ pageSize, recording, durationMs = DURATION } = {}) {
  const source = makeSource({ pageSize, recording });
  const view = makeView();
  const clock = makeClock();
  const engine = new PlaybackEngine({ startedAt: START, durationMs, source, view, clock });
  await engine.start();
  return { engine, source, view, clock };
}

const ids = (view) => view.state.toObjects().map((o) => o.id);

test('start shows the board as it was when the session began, paused', async () => {
  const { engine, view } = await setup();
  assert.deepEqual(engine.snapshot(), { time: 0, duration: DURATION, speed: 1, playing: false, loading: false, buffering: false, ended: false, error: null });
  assert.deepEqual(view.state.toObjects(), []);
});

test('playing applies each change when the clock reaches the moment it was recorded', async () => {
  const { engine, view, clock } = await setup();
  await engine.play();
  await clock.advance(1500);
  assert.deepEqual(ids(view), ['a'], 'a exists at 1.5s, b does not yet');
  await clock.advance(1000); // 2.5s
  assert.equal(engine.time, 2500);
  assert.deepEqual(view.state.toObjects(), expectedAt(2500));
  await clock.advance(1000); // 3.5s
  assert.deepEqual(view.state.toObjects(), expectedAt(3500));
  assert.equal(view.state.toObjects()[0].left, 50);
});

test('speed scales the clock: 2x covers the same history in half the time, 0.5x in double', async () => {
  const fast = await setup();
  fast.engine.setSpeed(2);
  await fast.engine.play();
  await fast.clock.advance(1250);
  assert.equal(fast.engine.time, 2500);
  assert.deepEqual(fast.view.state.toObjects(), expectedAt(2500));

  const slow = await setup();
  slow.engine.setSpeed(0.5);
  await slow.engine.play();
  await slow.clock.advance(5000);
  assert.equal(slow.engine.time, 2500);
  assert.deepEqual(slow.view.state.toObjects(), expectedAt(2500));

  const odd = await setup();
  odd.engine.setSpeed(3); // not an offered speed
  assert.equal(odd.engine.speed, 1);
  odd.engine.setSpeed(1.5);
  assert.equal(odd.engine.speed, 1.5);
});

test('pause freezes time and the picture; resume continues from the same moment', async () => {
  const { engine, view, clock } = await setup();
  await engine.play();
  await clock.advance(1500);
  engine.pause();
  const frozen = [engine.time, structuredClone(view.state.toObjects()), view.applied.length];
  await clock.advance(4000);
  assert.deepEqual([engine.time, view.state.toObjects(), view.applied.length], frozen);
  assert.equal(engine.playing, false);
  await engine.play();
  await clock.advance(1500);
  assert.equal(engine.time, 3000);
  assert.deepEqual(view.state.toObjects(), expectedAt(3000));
});

test('seeking shows exactly the state at that moment, and playing on never repeats or skips a change', async () => {
  const { engine, view, clock } = await setup();
  await engine.play();
  await clock.advance(1000);
  await engine.seek(6000); // was playing, so it keeps playing
  assert.equal(engine.playing, true);
  assert.equal(engine.time, 6000);
  assert.deepEqual(view.state.toObjects(), expectedAt(6000));
  const appliedBeforeSeekEnd = view.applied.length;

  await clock.advance(2500); // to 8.5s: event 6 (at 8s) happens
  assert.deepEqual(view.state.toObjects(), expectedAt(8500));
  assert.deepEqual(view.applied.slice(appliedBeforeSeekEnd).map((e) => e.seq), [6], 'only the change after the seek point was applied');

  await engine.seek(2500); // backwards
  assert.deepEqual(view.state.toObjects(), expectedAt(2500));
  assert.deepEqual(ids(view), ['a', 'b']);
});

test('seeking while paused stays paused', async () => {
  const { engine, view } = await setup();
  await engine.seek(4500);
  assert.equal(engine.playing, false);
  assert.equal(engine.time, 4500);
  assert.deepEqual(view.state.toObjects(), expectedAt(4500));
});

test('playing to the end applies everything, then reports ended; play again restarts', async () => {
  const { engine, view, clock } = await setup();
  await engine.play();
  await clock.advance(DURATION + 500);
  assert.equal(engine.ended, true);
  assert.equal(engine.playing, false);
  assert.equal(engine.time, DURATION);
  assert.deepEqual(view.state.toObjects(), expectedAt(DURATION));
  assert.deepEqual(view.applied.map((e) => e.seq), [1, 2, 3, 4, 5, 6], 'every change exactly once, in order');

  await engine.play(); // restart
  assert.equal(engine.ended, false);
  assert.equal(engine.time, 0);
  assert.deepEqual(view.state.toObjects(), []);
  assert.equal(engine.playing, true);
  await clock.advance(1500);
  assert.deepEqual(ids(view), ['a']);
});

test('events arrive in pages; playback never runs ahead of events it has not received yet', async () => {
  const { engine, source, view, clock } = await setup({ pageSize: 2 });
  // first page (seq 1,2) was fetched by start(); the next one is held up
  source.holdEvents = deferred();
  await engine.play();
  await clock.advance(5000);
  assert.equal(engine.time, 2000, 'clock waits at the last event it actually has');
  assert.equal(engine.buffering, true);
  assert.deepEqual(view.state.toObjects(), expectedAt(2000));

  source.holdEvents.resolve();
  source.holdEvents = null;
  await flush();
  await clock.advance(DURATION - 2000 + 200); // from where it waited (2s) to the end of the session
  assert.equal(engine.buffering, false);
  assert.equal(engine.ended, true, 'finished once the missing pages arrived');
  assert.deepEqual(view.state.toObjects(), expectedAt(DURATION));
  assert.deepEqual(view.applied.map((e) => e.seq), [1, 2, 3, 4, 5, 6]);
});

test('a slow, superseded seek is ignored: the latest one wins', async () => {
  const { engine, source, view } = await setup();
  const slow = deferred();
  source.delayNextState = slow;
  const first = engine.seek(3500); // will be slow
  const second = engine.seek(7000);
  await second;
  slow.resolve();
  await first;
  assert.equal(engine.time, 7000);
  assert.equal(engine.loading, false);
  assert.deepEqual(view.state.toObjects(), expectedAt(7000));
});

test('a failing request stops playback with an error instead of hanging', async () => {
  const { engine, source, clock } = await setup({ pageSize: 2 });
  source.failEvents = true;
  await engine.play();
  await clock.advance(3000);
  assert.ok(engine.error, 'error is surfaced');
  assert.equal(engine.playing, false);
  assert.equal(engine.loading, false);
});

test('changes recorded after the session length we were given (a live session) are ignored', async () => {
  const recording = [...RECORDING, [7, 11_000, { type: 'object:created', object: obj('late') }]];
  const { engine, view, clock } = await setup({ recording });
  await engine.play();
  await clock.advance(DURATION + 1000);
  assert.equal(engine.ended, true);
  assert.deepEqual(view.state.toObjects(), expectedAt(DURATION, recording));
  assert.ok(!ids(view).includes('late'));
});

test('subscribers get state changes; time updates are throttled, not per frame', async () => {
  const { engine, clock } = await setup();
  const seen = [];
  engine.subscribe((s) => seen.push(s));
  await engine.play();
  await clock.advance(1000); // ~62 frames
  assert.ok(seen.length >= 2, 'got updates');
  assert.ok(seen.length < 20, `throttled (got ${seen.length})`);
  assert.equal(seen[0].playing, true);
});

test('dispose stops everything', async () => {
  const { engine, view, clock } = await setup();
  await engine.play();
  engine.dispose();
  const n = view.applied.length;
  await clock.advance(5000);
  assert.equal(view.applied.length, n);
});
