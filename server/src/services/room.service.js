import { BoardState, MAX_BOARD_BYTES, eventToOp, opToEvent } from './boardState.js';

const key = (userId, batchId) => `${userId}:${batchId}`;

class Room {
  constructor(boardId, state) {
    this.boardId = boardId;
    this.state = state;
    this.recent = []; // [{ seq, userId, batchId, op }] — lets a briefly-disconnected client catch up with a delta
    this.recentBatches = new Map(); // `${userId}:${batchId}` -> result, makes re-sent batches idempotent
    this.presence = new Map(); // userId -> { user, sockets:Set }
    this.queue = Promise.resolve(); // serializes writes: sequence order == broadcast order
    this.eventsSinceSnapshot = 0;
    this.flushTimer = null;
    this.evictTimer = null;
    this.lastEditor = null;
    // Recording (Phase 4). `session` is the open session or null; see RoomManager.enter/exit.
    this.session = null;
    this.participantRecords = new Map(); // userId -> Promise<participantRowId | null>
    this.endTimer = null;
    this.emptiedAt = null;
  }

  get sequence() {
    return this.state.sequence;
  }

  /** Returns true if this is the user's first connection to the room (=> announce user:joined). */
  addPresence(user, socketId) {
    const entry = this.presence.get(user.id) ?? { user, sockets: new Set() };
    const isNew = entry.sockets.size === 0;
    entry.sockets.add(socketId);
    this.presence.set(user.id, entry);
    return isNew;
  }

  /** Returns true if that was the user's last connection (=> announce user:left). */
  removePresence(userId, socketId) {
    const entry = this.presence.get(userId);
    if (!entry) return false;
    entry.sockets.delete(socketId);
    if (entry.sockets.size) return false;
    this.presence.delete(userId);
    return true;
  }

  participants() {
    return [...this.presence.values()].map(({ user }) => ({ id: user.id, name: user.name, color: user.color }));
  }
}

/**
 * Owns the live state of every active board. Persistence goes through an injected `store`
 * (Mongo in production, in-memory in tests), so the sync rules can be tested without a database.
 *
 * Single-process by design: ordering relies on one in-memory queue per board. Scaling out would
 * mean routing each board to one owner process (sticky sessions) or a Redis-backed adapter.
 */
export class RoomManager {
  constructor(store, { snapshotEvery = 200, idleFlushMs = 15_000, evictAfterMs = 60_000, recentLimit = 2_000, batchMemory = 500, sessionGraceMs = 30_000, maxBoardBytes = MAX_BOARD_BYTES, snapshotRetryMs = 30_000 } = {}) {
    this.store = store;
    this.options = { snapshotEvery, idleFlushMs, evictAfterMs, recentLimit, batchMemory, sessionGraceMs, maxBoardBytes, snapshotRetryMs };
    this.loading = new Map(); // boardId -> Promise<Room>
    this.rooms = new Map(); // boardId -> Room (loaded)
  }

  async #load(boardId) {
    // Recovery = latest snapshot + every event after it. Never replays history from the start.
    const snapshot = await this.store.loadLatestSnapshot(boardId);
    const events = await this.store.loadEventsAfter(boardId, snapshot?.sequence ?? 0);
    const state = new BoardState(snapshot?.objects ?? [], snapshot?.sequence ?? 0);
    for (const event of events) {
      state.apply(eventToOp(event));
      state.sequence = event.sequence;
    }
    const room = new Room(boardId, state);
    room.eventsSinceSnapshot = events.length;
    return room;
  }

  async getRoom(boardId) {
    const id = String(boardId);
    let pending = this.loading.get(id);
    if (!pending) {
      pending = this.#load(id).then((room) => {
        this.rooms.set(id, room);
        return room;
      });
      pending.catch(() => this.loading.delete(id));
      this.loading.set(id, pending);
    }
    const room = await pending;
    clearTimeout(room.evictTimer);
    room.evictTimer = null;
    return room;
  }

  async getState(boardId) {
    const room = await this.getRoom(boardId);
    const state = { objects: room.state.toObjects(), sequence: room.sequence };
    this.release(room); // schedules eviction if nobody is connected
    return state;
  }

  /** Called when a client joins. Returns a delta when the client's lastSeq is still in the buffer. */
  async join(boardId, userId, { lastSeq, pendingBatchIds = [] } = {}) {
    const room = await this.getRoom(boardId);
    const knownBatchIds = pendingBatchIds.filter((b) => room.recentBatches.has(key(userId, b)));
    const oldest = room.recent[0]?.seq;
    const canDelta = lastSeq !== undefined && lastSeq <= room.sequence && (lastSeq === room.sequence || (oldest !== undefined && lastSeq >= oldest - 1));
    if (canDelta) {
      const ops = room.recent.filter((r) => r.seq > lastSeq).map((r) => ({ ...r.op, seq: r.seq, userId: r.userId, batchId: r.batchId }));
      return { room, mode: 'delta', ops, sequence: room.sequence, knownBatchIds };
    }
    return { room, mode: 'full', objects: room.state.toObjects(), sequence: room.sequence, knownBatchIds };
  }

  /* ───────────── presence & sessions ───────────── */

  /**
   * Registers a connection in the room. Starts a session if the room had none (or cancels the
   * pending end of one, when someone comes back within the grace period) and records the user's
   * arrival. Synchronous on purpose: callers rely on presence being set when this returns.
   * Returns true if this is the user's first connection (=> announce user:joined).
   */
  enter(room, user, socketId) {
    const isNew = room.addPresence(user, socketId);
    clearTimeout(room.endTimer);
    room.endTimer = null;
    room.emptiedAt = null;
    if (!room.session) this.#beginSession(room);
    if (isNew) this.#recordArrival(room, user.id, new Date());
    return isNew;
  }

  /** Counterpart of enter(). Returns true if that was the user's last connection (=> announce user:left). */
  exit(room, userId, socketId) {
    const now = new Date();
    const gone = room.removePresence(userId, socketId);
    if (gone) this.#recordDeparture(room, userId, now);
    if (room.presence.size === 0 && room.session && !room.endTimer) {
      room.emptiedAt = now; // the session ends when the last person left, not when the grace period runs out
      room.endTimer = setTimeout(() => this.#endSession(room, 'idle', now), this.options.sessionGraceMs);
      room.endTimer.unref?.();
    }
    return gone;
  }

  #beginSession(room) {
    const startedAt = new Date();
    const session = { id: null, failed: false, startedAt, startSequence: room.sequence, eventCount: 0, lastEventAt: null, ready: null };
    session.ready = this.store
      .createSession({ boardId: room.boardId, startedAt, startSequence: room.sequence })
      .then((doc) => {
        session.id = doc.id;
        return session;
      })
      .catch((err) => {
        // Recording must never take the live board down: events still persist, just untagged.
        session.failed = true;
        console.error('Could not create session record:', err);
        return session;
      });
    room.session = session;
  }

  #recordArrival(room, userId, joinedAt) {
    const session = room.session;
    const row = session.ready.then((s) => (s.failed ? null : this.store.addParticipant({ sessionId: s.id, boardId: room.boardId, userId, joinedAt })));
    room.participantRecords.set(userId, row.catch((err) => (console.error('Could not record participant:', err), null)));
  }

  #recordDeparture(room, userId, leftAt) {
    const row = room.participantRecords.get(userId);
    if (!row) return Promise.resolve();
    room.participantRecords.delete(userId);
    return row.then((id) => id && this.store.closeParticipant(id, leftAt)).catch((err) => console.error('Could not close participant:', err));
  }

  /** Closes the open session: remaining participants leave at `endedAt`, then counters are stored. */
  async #endSession(room, reason, endedAt = new Date()) {
    const session = room.session;
    if (!session) return;
    room.session = null;
    clearTimeout(room.endTimer);
    room.endTimer = null;
    await Promise.all([...room.participantRecords.keys()].map((userId) => this.#recordDeparture(room, userId, endedAt)));
    await room.queue; // let batches already accepted finish so the counters are complete
    await session.ready;
    if (session.failed) return;
    try {
      await this.store.endSession(session.id, {
        endedAt,
        endReason: reason,
        endSequence: room.sequence,
        eventCount: session.eventCount,
        lastEventAt: session.lastEventAt,
      });
    } catch (err) {
      console.error('Could not close session record:', err); // startup recovery repairs it from the events
    }
  }

  /** Clean shutdown: snapshot every board and close every open session. */
  async closeAll() {
    for (const room of this.rooms.values()) {
      clearTimeout(room.endTimer);
      await this.flush(room);
      await this.#endSession(room, 'shutdown');
    }
  }

  /**
   * Enqueues a batch. MUST be called synchronously from the socket handler (no awaits before it)
   * so batches from one socket enter the queue in the order they were sent.
   * `broadcast` and `ack` run back-to-back inside the queue so every client sees seq order.
   */
  submit(boardId, user, batch, { broadcast, ack }) {
    const room = this.rooms.get(String(boardId));
    if (!room) return ack({ ok: false, code: 'NOT_JOINED', message: 'Join the board first' });
    room.queue = room.queue
      .then(() => this.#process(room, user, batch, { broadcast, ack }))
      .catch((err) => {
        console.error('Room queue error:', err);
        ack({ ok: false, code: 'INTERNAL_ERROR', message: 'Could not apply changes' });
      });
  }

  async #process(room, user, { batchId, ops }, { broadcast, ack }) {
    const batchKey = key(user.id, batchId);
    const known = room.recentBatches.get(batchKey);
    if (known) return ack({ ok: true, duplicate: true, ...known });

    const { accepted, rejected } = room.state.plan(ops, { maxBytes: this.options.maxBoardBytes });
    if (!accepted.length) {
      const result = { seqStart: null, seqEnd: null, accepted: 0, rejected };
      this.#remember(room, batchKey, result);
      return ack({ ok: true, ...result });
    }

    const session = room.session ? await room.session.ready : null;
    const sessionId = session && !session.failed ? session.id : null;

    let start;
    let createdAt;
    try {
      start = await this.store.allocateSequence(room.boardId, accepted.length, user.id);
      createdAt = new Date();
      await this.store.insertEvents(
        accepted.map((op, i) => ({ boardId: room.boardId, sequence: start + i, ...opToEvent(op), userId: user.id, batchId, sessionId, createdAt }))
      );
    } catch (err) {
      console.error('Persisting operations failed:', err);
      return ack({ ok: false, code: 'PERSIST_FAILED', message: 'Could not save your changes. Retrying will be safe.' });
    }

    const prev = room.sequence;
    const applied = accepted.map((op, i) => ({ ...op, seq: start + i }));
    for (const op of applied) room.state.apply(op);
    room.state.sequence = start + accepted.length - 1;
    for (const op of applied) room.recent.push({ seq: op.seq, userId: user.id, batchId, op });
    if (room.recent.length > this.options.recentLimit) room.recent.splice(0, room.recent.length - this.options.recentLimit);

    if (session) {
      session.eventCount += accepted.length;
      session.lastEventAt = createdAt;
    }

    const result = { seqStart: start, seqEnd: room.sequence, accepted: accepted.length, rejected };
    this.#remember(room, batchKey, result);
    broadcast({ prev, userId: user.id, batchId, ops: applied });
    ack({ ok: true, ...result });
    this.#noteWrites(room, accepted.length, user.id);
  }

  #remember(room, batchKey, result) {
    room.recentBatches.set(batchKey, result);
    if (room.recentBatches.size > this.options.batchMemory) room.recentBatches.delete(room.recentBatches.keys().next().value);
  }

  #noteWrites(room, count, userId) {
    room.eventsSinceSnapshot += count;
    room.lastEditor = userId;
    // After a failed snapshot, wait before trying again: every attempt copies the whole board.
    if (room.eventsSinceSnapshot >= this.options.snapshotEvery && Date.now() >= (room.snapshotRetryAt ?? 0)) return void this.flush(room);
    if (!room.flushTimer) room.flushTimer = setTimeout(() => this.flush(room), this.options.idleFlushMs);
  }

  /** Writes a snapshot at the current sequence. Deep-copies first so it matches that exact sequence. */
  async flush(room) {
    clearTimeout(room.flushTimer);
    room.flushTimer = null;
    if (room.eventsSinceSnapshot === 0) return;
    const pending = room.eventsSinceSnapshot;
    room.eventsSinceSnapshot = 0;
    try {
      await this.store.saveSnapshot({ boardId: room.boardId, sequence: room.sequence, objects: structuredClone(room.state.toObjects()), savedBy: room.lastEditor });
      room.snapshotRetryAt = 0;
    } catch (err) {
      room.eventsSinceSnapshot += pending; // try again on a later write or idle flush
      room.snapshotRetryAt = Date.now() + this.options.snapshotRetryMs;
      console.error('Snapshot failed:', err);
    }
  }

  /** Call when a client leaves: snapshots immediately, evicts the room after a quiet period. */
  release(room) {
    if (room.presence.size > 0) return;
    this.flush(room);
    clearTimeout(room.evictTimer);
    room.evictTimer = setTimeout(() => {
      if (room.presence.size > 0) return;
      this.#endSession(room, 'idle', room.emptiedAt ?? new Date()); // no-op when the grace timer already ended it
      this.rooms.delete(room.boardId);
      this.loading.delete(room.boardId);
    }, this.options.evictAfterMs);
    room.evictTimer.unref?.();
  }

  /** Forget a board entirely (it was deleted). Persisted data is removed by the caller. */
  destroy(boardId) {
    const id = String(boardId);
    const room = this.rooms.get(id);
    if (room) {
      clearTimeout(room.flushTimer);
      clearTimeout(room.evictTimer);
      clearTimeout(room.endTimer);
      room.session = null; // the board's data (sessions included) is being deleted by the caller
    }
    this.rooms.delete(id);
    this.loading.delete(id);
  }
}
