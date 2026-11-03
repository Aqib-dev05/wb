import { Server } from 'socket.io';
import { CallManager } from '../services/call.service.js';
import { callJoinSchema, callLeaveSchema, callMediaSchema, callSignalSchema, cursorSchema, joinSchema, leaveSchema, submitSchema, transientSchema } from '../validators/ops.validators.js';

const roomName = (boardId) => `board:${boardId}`;
const userRoom = (userId) => `user:${userId}`; // every socket of one person; used for notifications
const callRoom = (boardId) => `call:${boardId}`;
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
export function initSockets(httpServer, { rooms, authenticate, getRole, corsOrigin, calls = new CallManager() }) {
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

  // Everyone on the board (not just those in the call) learns how many people are on a call, to show "call in progress".
  const announceCall = (boardId) => io.to(roomName(boardId)).emit('call:count', { boardId, count: calls.size(boardId) });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(userRoom(user.id));
    const boards = new Map(); // boardId -> role, for boards this socket has joined
    memberships.set(socket.id, boards);
    const allowOps = makeLimiter();
    let lastCursorAt = 0;

    const leaveCall = (boardId) => {
      if (!calls.leave(boardId, socket.id)) return;
      socket.leave(callRoom(boardId));
      socket.to(callRoom(boardId)).emit('call:peer-left', { boardId, socketId: socket.id, userId: user.id });
      announceCall(boardId);
    };

    const leaveBoard = (boardId) => {
      leaveCall(boardId); // a call only exists for people who are on the board
      if (!boards.delete(boardId)) return;
      socket.leave(roomName(boardId));
      const room = rooms.rooms.get(boardId);
      if (room && rooms.exit(room, user.id, socket.id)) socket.to(roomName(boardId)).emit('user:left', { boardId, userId: user.id });
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
        if (rooms.enter(joined.room, user, socket.id)) socket.to(roomName(boardId)).emit('user:joined', { boardId, user });

        const { room, ...snapshot } = joined;
        ack?.({ ok: true, role, you: user, participants: room.participants(), callCount: calls.size(boardId), ...snapshot });
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

    // ---- live video/voice: this server only keeps the roster and relays signalling; media flows peer to peer ----
    const allowSignal = makeLimiter({ capacity: 200, refillPerSec: 100 }); // ICE trickle is bursty

    socket.on('call:join', (payload, ack) => {
      const parsed = callJoinSchema.safeParse(payload);
      if (!parsed.success) return fail(ack, 'BAD_REQUEST', 'Invalid call request');
      const { boardId, audio, video } = parsed.data;
      if (!boards.has(boardId)) return fail(ack, 'NOT_JOINED', 'Join the board first');
      const res = calls.join(boardId, socket.id, user, { audio, video });
      if (!res.ok) return fail(ack, 'CALL_FULL', `This call is full (${calls.maxPeers} people at most)`);
      const wasNew = !res.peers.some((p) => p.socketId === socket.id);
      socket.join(callRoom(boardId));
      if (wasNew) {
        socket.to(callRoom(boardId)).emit('call:peer-joined', { boardId, peer: res.peer });
        announceCall(boardId);
      }
      ack?.({ ok: true, you: socket.id, peers: res.peers.filter((p) => p.socketId !== socket.id) });
    });

    socket.on('call:leave', (payload) => {
      const parsed = callLeaveSchema.safeParse(payload);
      if (parsed.success) leaveCall(parsed.data.boardId);
    });

    socket.on('call:media', (payload) => {
      const parsed = callMediaSchema.safeParse(payload);
      if (!parsed.success) return;
      const { boardId, audio, video } = parsed.data;
      const peer = calls.setMedia(boardId, socket.id, { audio, video });
      if (peer) socket.to(callRoom(boardId)).emit('call:media', { boardId, socketId: socket.id, audio: peer.audio, video: peer.video });
    });

    // Offer / answer / ICE candidate for one specific peer. Only relayed between two members of the same call.
    socket.on('call:signal', (payload) => {
      const parsed = callSignalSchema.safeParse(payload);
      if (!parsed.success || !allowSignal()) return;
      const { boardId, to, description, candidate } = parsed.data;
      if (!calls.has(boardId, socket.id) || !calls.has(boardId, to)) return;
      io.to(to).emit('call:signal', { boardId, from: socket.id, description, candidate });
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
        if (calls.leave(boardId, s.id)) {
          s.leave(callRoom(boardId));
          io.to(callRoom(boardId)).emit('call:peer-left', { boardId, socketId: s.id, userId });
          announceCall(boardId);
        }
        memberships.get(s.id)?.delete(boardId); // without this the socket could still submit ops
        const room = rooms.rooms.get(String(boardId));
        if (room && rooms.exit(room, userId, s.id)) io.to(roomName(boardId)).emit('user:left', { boardId, userId });
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

    /** Closes every live connection of one person (their password was reset); clients must sign in again. */
    disconnectUser(userId) {
      io.in(userRoom(userId)).disconnectSockets(true);
    },

    /** Pushes a notification to every open tab/device of one person. */
    notifyUser(userId, payload) {
      io.to(userRoom(userId)).emit('notification:new', payload);
    },

    /** Call roster for a board (read-only, for the "call in progress" hint). */
    callParticipants(boardId) { return calls.list(boardId).map((p) => ({ socketId: p.socketId, user: p.user })); },

    closeBoard(boardId) {
      for (const p of calls.list(boardId)) calls.leave(boardId, p.socketId);
      io.in(callRoom(boardId)).socketsLeave(callRoom(boardId));
      io.to(roomName(boardId)).emit('board:deleted', { boardId });
      io.in(roomName(boardId)).socketsLeave(roomName(boardId));
    },
  };
}
