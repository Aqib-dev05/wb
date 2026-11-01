import { io } from 'socket.io-client';
import { getAccessToken, refreshSession } from '../services/api.js';

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const ACK_TIMEOUT_MS = 12_000;
const CURSOR_INTERVAL_MS = 40;
const TRANSIENT_INTERVAL_MS = 60;

/**
 * Connects one CanvasController to one board room.
 *
 * Data flow
 *   local edit  -> controller 'ops' -> batch queue -> `ops:submit` -> ack (seq numbers)
 *   remote edit -> `ops:applied` -> controller.applyRemoteOps (never re-emitted, so no echo loops)
 *
 * Guarantees
 *   - Batches are sent in order and stay in `pending` until the server acknowledges them, so
 *     nothing is lost while offline or across a reconnect.
 *   - Every batch has an id; if an ack is lost the server recognises the batch on rejoin
 *     (`knownBatchIds`) and it is not applied twice.
 *   - Each broadcast carries `prev`. If it does not match the last sequence we processed we
 *     missed something and rejoin (delta if the server still has the ops, full state otherwise).
 *
 * Status: 'connecting' | 'live' | 'offline' | 'denied' | 'closed'
 * Events (via `on`): status, presence, cursor, pending, role, error, kicked, deleted
 */
export class SyncSession {
  constructor(boardId, controller) {
    this.boardId = boardId;
    this.controller = controller;
    this.status = 'connecting';
    this.role = null;
    this.you = null;
    this.lastSeq = 0;
    this.joined = false;
    this.pending = []; // [{ batchId, ops, sent }]
    this.listeners = new Map();
    this.participants = new Map();
    this.cursors = new Map();
    this.destroyed = false;
    this.resyncing = false;
    this.needsResync = false;
    this.lastCursorAt = 0;
    this.lastTransientAt = 0;
    this.joining = false;
    this.inbox = []; // broadcasts that arrive while a join is being applied
    this.sentIds = new Set(); // batches this session sent (to recognise its own ops in a delta)

    this.offs = [
      controller.on('ops', (ops) => this.#queue(ops)),
      controller.on('transient', (t) => this.#sendTransient(t)),
      controller.on('pointer', (p) => this.#sendCursor(p)),
    ];

    this.socket = io({
      // Fresh token on every (re)connect attempt; the access token is short-lived.
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnectionDelayMax: 4000,
      transports: ['websocket', 'polling'],
    });
    this.#bind();
  }

  on(event, fn) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(fn);
    this.listeners.set(event, set);
    return () => set.delete(fn);
  }

  #emit(event, payload) {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }

  #setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.#emit('status', status);
  }

  get pendingOps() {
    return this.pending.flatMap((b) => b.ops);
  }

  get unsyncedCount() {
    return this.pending.length;
  }

  #bind() {
    const s = this.socket;
    s.on('connect', () => this.#join());
    s.on('disconnect', (reason) => {
      this.joined = false;
      this.pending.forEach((b) => { b.sent = false; });
      this.participants.clear();
      this.cursors.clear();
      this.#emit('presence', []);
      this.#emit('cursor', null);
      if (!this.destroyed && this.status !== 'denied' && this.status !== 'closed') this.#setStatus('offline');
      // socket.io only auto-reconnects after network failures; when the *server* ends the connection
      // (restart, deploy) we have to ask again ourselves.
      if (reason === 'io server disconnect' && !this.destroyed && this.status === 'offline') setTimeout(() => !this.destroyed && !s.connected && s.connect(), 1000);
    });
    s.on('connect_error', async (err) => {
      if (this.destroyed) return;
      if (err.message === 'TOKEN_EXPIRED') {
        try {
          await refreshSession();
          s.connect();
        } catch {
          this.#fatal('denied', 'Your session expired. Sign in again.');
        }
      } else if (err.message === 'UNAUTHORIZED') {
        this.#fatal('denied', 'You are not signed in.');
      } else {
        this.#setStatus('offline');
      }
    });

    s.on('ops:applied', (msg) => this.#onApplied(msg));
    s.on('cursor:moved', ({ userId, x, y }) => this.#emit('cursor', { userId, x, y }));
    s.on('object:transient', ({ id, patch }) => this.controller.applyTransient({ id, patch }));
    s.on('user:joined', ({ user }) => {
      this.participants.set(user.id, user);
      this.#emit('presence', [...this.participants.values()]);
    });
    s.on('user:left', ({ userId }) => {
      this.participants.delete(userId);
      this.#emit('presence', [...this.participants.values()]);
      this.#emit('cursor', { userId, gone: true });
    });
    s.on('board:role', ({ role }) => {
      this.role = role;
      this.#emit('role', role);
    });
    s.on('board:kicked', () => this.#fatal('denied', 'You no longer have access to this board.', 'kicked'));
    s.on('board:deleted', () => this.#fatal('closed', 'This board was deleted.', 'deleted'));
  }

  #fatal(status, message, event = 'error') {
    this.#setStatus(status);
    this.#emit(event, message);
    this.socket.disconnect();
  }

  // ---- join / resync -------------------------------------------------------------------------

  #join({ full = false } = {}) {
    if (this.destroyed) return Promise.resolve();
    this.#setStatus('connecting');
    this.joining = true;
    this.inbox = [];
    return new Promise((resolve) => {
      const payload = {
        boardId: this.boardId,
        ...(full || !this.hasState ? {} : { lastSeq: this.lastSeq }),
        pendingBatchIds: this.pending.map((b) => b.batchId).slice(0, 100),
      };
      this.socket.timeout(ACK_TIMEOUT_MS).emit('board:join', payload, async (err, res) => {
        if (err) { this.joining = false; this.#setStatus('offline'); this.socket.disconnect().connect(); return resolve(); }
        if (!res?.ok) {
          this.joining = false;
          if (res?.code === 'FORBIDDEN') this.#fatal('denied', res.message);
          else { this.#emit('error', res?.message ?? 'Could not open the board'); this.#setStatus('offline'); }
          return resolve();
        }
        try {
          await this.#onJoined(res);
        } catch (e) {
          console.error('Join failed:', e);
          this.#emit('error', 'Could not load the board');
        }
        this.joining = false;
        await this.#drainInbox();
        resolve();
      });
    });
  }

  async #onJoined(res) {
    this.role = res.role;
    this.you = res.you;
    this.#emit('role', res.role);
    this.participants = new Map(res.participants.filter((p) => p.id !== res.you.id).map((p) => [p.id, p]));
    this.#emit('presence', [...this.participants.values()]);

    // Batches the server already holds (their ack was lost): drop them, never resend.
    const known = new Set(res.knownBatchIds ?? []);
    this.pending = this.pending.filter((b) => !known.has(b.batchId));
    const stillPending = this.pendingOps;

    if (res.mode === 'full') {
      await this.controller.replaceAll(res.objects);
      if (!this.hasState) this.controller.history.reset();
      this.hasState = true;
      this.lastSeq = res.sequence;
      if (stillPending.length) await this.controller.applyLocalOps(stillPending); // our unsent edits survive a full resync
      this.#emit('loaded', { initial: !this.loadedOnce });
    } else {
      // Skip our own ops (already applied locally); protect properties we still have in flight.
      const remote = res.ops.filter((o) => !(o.userId === res.you.id && this.sentIds.has(o.batchId)));
      if (remote.length) await this.controller.applyRemoteOps(remote, () => this.pendingOps);
      this.lastSeq = res.sequence;
    }
    this.loadedOnce = true;
    this.joined = true;
    this.#setStatus('live');
    this.#flush();
  }

  /** Rejoin after a detected gap or a rejected op. */
  async #resync({ full = false } = {}) {
    if (this.resyncing) { this.needsResync = this.needsResync || full; return; }
    this.resyncing = true;
    this.joined = false;
    try {
      await this.#join({ full });
    } finally {
      this.resyncing = false;
    }
  }

  // ---- outgoing ------------------------------------------------------------------------------

  #queue(ops) {
    if (this.role === 'viewer' || !ops?.length) return;
    // Large selections are split so each batch stays well under the server's per-batch cap.
    for (let i = 0; i < ops.length; i += 200) {
      this.pending.push({ batchId: uid(), ops: ops.slice(i, i + 200), sent: false });
    }
    this.#emit('pending', this.pending.length);
    this.#flush();
  }

  #flush() {
    if (!this.joined || this.resyncing) return;
    for (const batch of this.pending) {
      if (batch.sent) continue;
      batch.sent = true;
      this.sentIds.add(batch.batchId);
      if (this.sentIds.size > 1000) this.sentIds.delete(this.sentIds.values().next().value);
      this.socket.timeout(ACK_TIMEOUT_MS).emit('ops:submit', { boardId: this.boardId, batchId: batch.batchId, ops: batch.ops }, (err, res) => this.#onAck(batch, err, res));
    }
  }

  #onAck(batch, err, res) {
    if (this.destroyed) return;
    if (err) {
      // No answer: the server may or may not have it. Rejoin; `knownBatchIds` settles it.
      this.#resync();
      return;
    }
    if (!res?.ok) {
      if (res?.code === 'PERSIST_FAILED' || res?.code === 'INTERNAL_ERROR' || res?.code === 'RATE_LIMITED') {
        batch.sent = false; // safe to retry: the server de-duplicates by batchId
        this.#emit('error', res.message);
        setTimeout(() => this.#flush(), 1500);
        return;
      }
      // FORBIDDEN / BAD_REQUEST / NOT_JOINED: the batch can never succeed. Drop it and resync.
      this.pending = this.pending.filter((b) => b !== batch);
      this.#emit('pending', this.pending.length);
      this.#emit('error', res?.message ?? 'Your changes were not accepted');
      this.#resync({ full: true });
      return;
    }
    this.pending = this.pending.filter((b) => b !== batch);
    this.#emit('pending', this.pending.length);
    if (res.seqEnd != null) this.lastSeq = Math.max(this.lastSeq, res.seqEnd);
    // Some of our ops no longer apply (e.g. the object was deleted by someone else): converge on server state.
    if (res.rejected?.length) {
      if (res.rejected.some((r) => r.reason === 'board_full')) this.#emit('error', 'This board is full, so your last change was not saved. Delete some content to make room.');
      this.#resync({ full: true });
    }
  }

  #sendCursor({ x, y }) {
    const now = Date.now();
    if (!this.joined || now - this.lastCursorAt < CURSOR_INTERVAL_MS) return;
    this.lastCursorAt = now;
    this.socket.volatile.emit('cursor:moved', { boardId: this.boardId, x, y });
  }

  #sendTransient({ id, patch }) {
    const now = Date.now();
    if (!this.joined || this.role === 'viewer' || now - this.lastTransientAt < TRANSIENT_INTERVAL_MS) return;
    this.lastTransientAt = now;
    this.socket.volatile.emit('object:transient', { boardId: this.boardId, id, patch });
  }

  // ---- incoming ------------------------------------------------------------------------------

  async #drainInbox() {
    const queued = this.inbox.splice(0);
    for (const msg of queued) await this.#onApplied(msg);
  }

  async #onApplied(msg) {
    if (msg.boardId !== this.boardId) return;
    if (this.joining || !this.joined) {
      if (this.joining) this.inbox.push(msg);
      return;
    }
    if (msg.ops[msg.ops.length - 1].seq <= this.lastSeq) return; // already covered by the join
    if (msg.prev !== this.lastSeq) {
      // Anything out of order is ignored: the rejoin below fetches everything after lastSeq.
      if (msg.prev > this.lastSeq) this.#resync();
      return;
    }
    const last = msg.ops[msg.ops.length - 1].seq;
    this.lastSeq = last;
    await this.controller.applyRemoteOps(msg.ops, () => this.pendingOps);
  }

  /** Sends whatever is still queued, then closes. Used on leave. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.offs.forEach((off) => off());
    if (this.socket.connected) {
      for (const batch of this.pending) {
        if (!batch.sent && this.joined) this.socket.emit('ops:submit', { boardId: this.boardId, batchId: batch.batchId, ops: batch.ops });
      }
      this.socket.emit('board:leave', { boardId: this.boardId });
    }
    this.socket.disconnect();
    this.listeners.clear();
  }
}
