import { Server } from 'socket.io';
import { cursorSchema, joinSchema, leaveSchema, submitSchema, transientSchema } from '../validators/ops.validators.js';

const roomName = (boardId) => `board:${boardId}`;
const CURSOR_MIN_INTERVAL_MS = 25;

// Simple token bucket so one misbehaving client can't flood the board queue.
function makeLimiter({ capacity = 30, refillPerSec = 15 } = {}) {
  let tokens = capacity;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const fail = (ack, code, message) => typeof ack === 'function' && ack({ ok: false, code, message });

/**
 * Real-time layer. Dependencies are injected so the same code runs against Mongo in production
 * and against in-memory fakes in tests:
 *   authenticate(token) -> { id, name, color }   (throws Error with .code 'TOKEN_EXPIRED' | 'UNAUTHORIZED')
 *   getRole(boardId, userId) -> 'owner' | 'editor' | 'viewer' | null
 *   rooms: RoomManager
 */
export function initSockets(httpServer, { rooms, authenticate, getRole, corsOrigin }) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    maxHttpBufferSize: 6e6,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  // Authentication happens once per connection, in the handshake. The client re-sends a fresh
  // access token on every reconnect attempt.
  io.use(async (socket, next) => {
    try {
      socket.data.user = await authenticate(socket.handshake.auth?.token);
      next();
    } catch (err) {
      next(new Error(err.code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED'));
    }
  });

  // socket.id -> (boardId -> role). Lives at server level so a role change takes effect on the next op.
  const memberships = new Map();

  io.on('connection', (socket) => {
    const user = socket.data.user;
    const boards = new Map(); // boardId -> role, for boards this socket has joined
    memberships.set(socket.id, boards);
    const allowOps = makeLimiter();
    let lastCursorAt = 0;

    const leaveBoard = (boardId) => {
      if (!boards.delete(boardId)) return;
      socket.leave(roomName(boardId));
      const room = rooms.rooms.get(boardId);
      if (room?.removePresence(user.id, socket.id)) socket.to(roomName(boardId)).emit('user:left', { boardId, userId: user.id });
      if (room) rooms.release(room);
    };

    socket.on('board:join', async (payload, ack) => {
      try {
        const parsed = joinSchema.safeParse(payload);
        if (!parsed.success) return fail(ack, 'BAD_REQUEST', 'Invalid join request');
        const { boardId, lastSeq, pendingBatchIds } = parsed.data;

        // Authorization is decided here, on the server, from the membership collection.
        const role = await getRole(boardId, user.id);
        if (!role) return fail(ack, 'FORBIDDEN', 'You do not have access to this board');

        const joined = await rooms.join(boardId, user.id, { lastSeq, pendingBatchIds });
        if (socket.disconnected) return rooms.release(joined.room);

        boards.set(boardId, role);
        socket.join(roomName(boardId));
        if (joined.room.addPresence(user, socket.id)) socket.to(roomName(boardId)).emit('user:joined', { boardId, user });

        const { room, ...snapshot } = joined;
        ack?.({ ok: true, role, you: user, participants: room.participants(), ...snapshot });
      } catch (err) {
        console.error('board:join failed:', err);
        fail(ack, 'INTERNAL_ERROR', 'Could not open the board');
      }
    });

    socket.on('board:leave', (payload) => {
      const parsed = leaveSchema.safeParse(payload);
      if (parsed.success) leaveBoard(parsed.data.boardId);
    });

    // Client -> server: one batch of operations (object:created/updated/deleted/reordered).
    // Validation and enqueueing are synchronous so per-socket ordering is preserved.
    socket.on('ops:submit', (payload, ack) => {
      const parsed = submitSchema.safeParse(payload);
      if (!parsed.success) return fail(ack, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? 'Invalid operations');
      const { boardId, batchId, ops } = parsed.data;
      const role = boards.get(boardId);
      if (!role) return fail(ack, 'NOT_JOINED', 'Join the board first');
      if (role === 'viewer') return fail(ack, 'FORBIDDEN', 'You have view-only access to this board');
      if (!allowOps()) return fail(ack, 'RATE_LIMITED', 'Too many changes too quickly');
      rooms.submit(boardId, user, { batchId, ops }, {
        // Server -> other clients: the accepted ops, each with its server sequence number.
        broadcast: (message) => socket.to(roomName(boardId)).emit('ops:applied', { boardId, ...message }),
        ack: (result) => typeof ack === 'function' && ack(result),
      });
    });

    // Ephemeral signals: not validated against state, never persisted, dropped under load.
    socket.on('cursor:moved', (payload) => {
      const now = Date.now();
      if (now - lastCursorAt < CURSOR_MIN_INTERVAL_MS) return;
      const parsed = cursorSchema.safeParse(payload);
      if (!parsed.success || !boards.has(parsed.data.boardId)) return;
      lastCursorAt = now;
      const { boardId, x, y } = parsed.data;
      socket.to(roomName(boardId)).volatile.emit('cursor:moved', { boardId, userId: user.id, x, y });
    });

    socket.on('object:transient', (payload) => {
      const parsed = transientSchema.safeParse(payload);
      if (!parsed.success) return;
      const { boardId, id, patch } = parsed.data;
      const role = boards.get(boardId);
      if (!role || role === 'viewer') return;
      socket.to(roomName(boardId)).volatile.emit('object:transient', { boardId, userId: user.id, id, patch });
    });

    socket.on('disconnect', () => {
      for (const boardId of [...boards.keys()]) leaveBoard(boardId);
      memberships.delete(socket.id);
    });
  });

  return {
    io,

    /** Removes a user's access immediately (they were removed from the board). */
    async kickUser(boardId, userId) {
      const sockets = await io.in(roomName(boardId)).fetchSockets();
      for (const s of sockets) {
        if (s.data.user.id !== userId) continue;
        s.emit('board:kicked', { boardId });
        s.leave(roomName(boardId));
        memberships.get(s.id)?.delete(boardId); // without this the socket could still submit ops
        const room = rooms.rooms.get(String(boardId));
        if (room?.removePresence(userId, s.id)) io.to(roomName(boardId)).emit('user:left', { boardId, userId });
        if (room) rooms.release(room);
      }
    },

    /** Tells a user's connected clients their role changed (the server re-checks on every op). */
    async setRole(boardId, userId, role) {
      const sockets = await io.in(roomName(boardId)).fetchSockets();
      for (const s of sockets) {
        if (s.data.user.id !== userId) continue;
        const boards = memberships.get(s.id);
        if (boards?.has(boardId)) boards.set(boardId, role);
        s.emit('board:role', { boardId, role });
      }
    },

    closeBoard(boardId) {
      io.to(roomName(boardId)).emit('board:deleted', { boardId });
      io.in(roomName(boardId)).socketsLeave(roomName(boardId));
    },
  };
}
