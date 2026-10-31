// Plays a recorded session back. Knows nothing about Fabric, React or the network: it is driven by
//   source  – { loadState(offsetMs) -> { sequence, objects }, loadEvents(afterSeq) -> { events, hasMore, nextAfter } }
//   view    – { reset(objects) -> Promise, apply(ops) -> Promise }   (the read-only canvas)
//   clock   – { now(), request(cb), cancel(handle) }                  (requestAnimationFrame in the browser)
//
// Seeking asks the server for the board as it was at that moment (nearest snapshot + the events
// after it) and replaces the view. Playing then streams the session's events in pages and applies
// each one when the playback clock reaches the moment it was recorded.
// The engine only ever talks to a *view of history*; it cannot reach the live board.

export const SPEEDS = [0.5, 1, 1.5, 2];

const PREFETCH_BELOW = 120; // fetch the next page when fewer events than this are buffered ahead
const MAX_FRAME_MS = 250; // a stalled tab must not make the clock leap forward
const EMIT_EVERY_MS = 100; // the time readout does not need to update every frame
const MAX_BATCH = 500;

const browserClock = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class PlaybackEngine {
  /** `startedAt`: session start (ms since epoch, server time) — event offsets are measured from it. */
  constructor({ startedAt, durationMs, source, view, clock = browserClock }) {
    this.startedAt = startedAt;
    this.duration = Math.max(0, durationMs);
    this.source = source;
    this.view = view;
    this.clock = clock;

    this.time = 0;
    this.speed = 1;
    this.playing = false;
    this.loading = true; // true until the first state is on screen, and while seeking
    this.buffering = false; // playing, but waiting for the next page of events
    this.ended = false;
    this.error = null;

    this.generation = 0; // bumped by every seek/dispose; stale async work checks it and gives up
    this.buffer = []; // events not yet applied, each with `t` = ms since session start
    this.cursor = 0;
    this.nextAfter = 0;
    this.hasMore = true;
    this.fetching = null;
    this.applyPromise = Promise.resolve();
    this.applying = false;
    this.frameHandle = null;
    this.lastFrame = 0;
    this.lastEmit = 0;
    this.listeners = new Set();
    this.disposed = false;
  }

  /* ───────────── public API ───────────── */

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot() {
    const { time, duration, speed, playing, loading, buffering, ended, error } = this;
    return { time, duration, speed, playing, loading, buffering, ended, error };
  }

  /** Loads the start of the session. Call once. */
  start() {
    return this.seek(0, { resume: false });
  }

  async play() {
    if (this.disposed || this.loading || this.error) return;
    if (this.ended || this.time >= this.duration) return this.seek(0, { resume: true });
    if (this.playing) return;
    this.playing = true;
    this.#emit(true);
    this.#startLoop();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.buffering = false;
    this.#stopLoop();
    this.#emit(true);
  }

  toggle() {
    return this.playing ? this.pause() : this.play();
  }

  setSpeed(speed) {
    if (!SPEEDS.includes(speed) || speed === this.speed) return;
    this.speed = speed;
    this.#emit(true);
  }

  /** Jumps to `ms` after the session started. Resumes playing afterwards if it was playing (or `resume` says so). */
  async seek(ms, { resume } = {}) {
    if (this.disposed) return;
    const generation = ++this.generation;
    const target = Math.min(this.duration, Math.max(0, ms));
    const shouldResume = resume ?? this.playing;

    this.#stopLoop();
    this.playing = false;
    this.buffering = false;
    this.ended = false;
    this.loading = true;
    this.error = null;
    this.time = target;
    this.#emit(true);

    try {
      const state = await this.source.loadState(target);
      if (generation !== this.generation) return;
      await this.applyPromise; // never reset the view while ops from the previous position are still landing
      if (generation !== this.generation) return;
      await this.view.reset(state.objects);
      if (generation !== this.generation) return;

      this.buffer = [];
      this.cursor = 0;
      this.nextAfter = state.sequence;
      this.hasMore = true;
      this.fetching = null;
      await this.#fill(generation);
      if (generation !== this.generation) return;
    } catch (err) {
      if (generation === this.generation) this.#fail(err);
      return;
    }

    this.loading = false;
    this.#emit(true);
    if (shouldResume && target < this.duration) await this.play();
    else this.#finishIfDone(); // seeking to the very end shows the final state and counts as ended
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.#stopLoop();
    this.listeners.clear();
  }

  /* ───────────── internals ───────────── */

  /** Fetches one more page of events (no-op while one is in flight or when everything is loaded). */
  #fill(generation) {
    if (this.fetching) return this.fetching;
    if (!this.hasMore) return Promise.resolve();
    const request = this.source
      .loadEvents(this.nextAfter)
      .then((page) => {
        if (generation !== this.generation) return;
        let more = page.hasMore;
        for (const event of page.events) {
          const t = event.at - this.startedAt;
          if (t > this.duration) {
            more = false; // recorded after the length we were given (a session that is still live): out of scope
            continue;
          }
          this.buffer.push({ ...event, t });
        }
        this.nextAfter = page.nextAfter;
        this.hasMore = more && page.events.length > 0; // an empty page must never loop forever
      })
      .finally(() => {
        if (this.fetching === request) this.fetching = null;
      });
    this.fetching = request;
    return request;
  }

  #startLoop() {
    this.lastFrame = this.clock.now();
    const generation = this.generation;
    const frame = () => {
      this.frameHandle = null;
      if (!this.playing || generation !== this.generation) return;
      this.#frame(generation);
      if (this.playing && generation === this.generation) this.frameHandle = this.clock.request(frame);
    };
    this.frameHandle = this.clock.request(frame);
  }

  #stopLoop() {
    if (this.frameHandle !== null) this.clock.cancel(this.frameHandle);
    this.frameHandle = null;
  }

  #frame(generation) {
    const now = this.clock.now();
    const dt = Math.min(MAX_FRAME_MS, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;

    const ahead = this.buffer.length - this.cursor;
    if (this.hasMore && ahead < PREFETCH_BELOW && !this.fetching) {
      this.#fill(generation).catch((err) => generation === this.generation && this.#fail(err));
    }

    // The clock may not run past the last event we have: events in the page still in flight could
    // belong to earlier moments, and applying them late would show history out of order.
    const horizon = this.hasMore ? (this.buffer.at(-1)?.t ?? this.time) : this.duration;
    const next = Math.min(horizon, this.time + dt * this.speed);
    const starved = this.hasMore && next >= horizon;
    this.time = Math.min(this.duration, Math.max(this.time, next));
    if (starved !== this.buffering) {
      this.buffering = starved;
      this.#emit(true);
    }

    if (!this.applying && this.cursor < this.buffer.length && this.buffer[this.cursor].t <= this.time) {
      let end = this.cursor;
      while (end < this.buffer.length && end - this.cursor < MAX_BATCH && this.buffer[end].t <= this.time) end++;
      const ops = this.buffer.slice(this.cursor, end);
      this.cursor = end;
      if (this.cursor > 1000) {
        this.buffer.splice(0, this.cursor); // keep the buffer small on long sessions
        this.cursor = 0;
      }
      this.applying = true;
      this.applyPromise = Promise.resolve(this.view.apply(ops))
        .catch((err) => generation === this.generation && this.#fail(err))
        .finally(() => {
          this.applying = false;
        });
    }

    this.#emit(false);
    this.#finishIfDone();
  }

  #finishIfDone() {
    if (this.applying || this.hasMore || this.cursor < this.buffer.length || this.time < this.duration) return;
    this.playing = false;
    this.buffering = false;
    this.ended = true;
    this.#stopLoop();
    this.#emit(true);
  }

  #fail(err) {
    this.error = err?.message || 'Playback failed';
    this.playing = false;
    this.loading = false;
    this.buffering = false;
    this.#stopLoop();
    this.#emit(true);
  }

  #emit(force) {
    const now = this.clock.now();
    if (!force && now - this.lastEmit < EMIT_EVERY_MS) return;
    this.lastEmit = now;
    const snap = this.snapshot();
    this.listeners.forEach((fn) => fn(snap));
  }
}
