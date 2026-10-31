import { ApiError } from '../utils/ApiError.js';
import { BoardState, eventToOp } from './boardState.js';

// Read side of session recording. Everything here goes through the injected `store` (Mongo in
// production, memory in tests) and never touches a live Room, so replaying history cannot affect
// the board people are editing.

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * The board exactly as it was after `sequence`: the nearest snapshot at or before it, plus only the
 * events recorded after that snapshot. Snapshots are written every ~200 events, so this replays a
 * bounded number of events no matter how long the board's history is.
 */
export async function stateAtSequence(store, boardId, sequence) {
  const snapshot = await store.findSnapshotAtOrBefore(boardId, sequence);
  const base = snapshot?.sequence ?? 0;
  const events = await store.findEventsBetween(boardId, base, sequence);
  const state = new BoardState(structuredClone(snapshot?.objects ?? []), base);
  for (const event of events) state.apply(eventToOp(event));
  return { objects: state.toObjects(), snapshotSequence: base, replayed: events.length };
}

/** Open sessions keep their counters in memory (RoomManager); derive them from the events instead. */
async function withCounters(store, session) {
  if (session.endedAt) return session;
  const stats = await store.getSessionStats(session.id);
  return { ...session, eventCount: stats.count, endSequence: stats.lastSequence ?? session.startSequence, lastEventAt: stats.lastEventAt };
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

function serialize(session, participants = []) {
  const end = session.endedAt ? +new Date(session.endedAt) : Date.now();
  return {
    id: session.id,
    startedAt: iso(session.startedAt),
    endedAt: iso(session.endedAt),
    live: !session.endedAt,
    endReason: session.endReason,
    durationMs: Math.max(0, end - +new Date(session.startedAt)),
    startSequence: session.startSequence,
    endSequence: session.endSequence ?? session.startSequence,
    eventCount: session.eventCount,
    participants,
  };
}

/** userId -> { id, name, color } for everyone who appears in `rows` (users deleted since are skipped). */
async function userDirectory(store, rows) {
  const users = await store.findUsers([...new Set(rows.map((r) => r.userId))]);
  return new Map(users.map((u) => [u.id, u]));
}

async function mustGetSession(store, boardId, sessionId) {
  const session = await store.getSession(boardId, sessionId);
  if (!session) throw ApiError.notFound('Session not found');
  return withCounters(store, session);
}

export async function listSessions(store, boardId, { page = 1, limit = 20, includeEmpty = false } = {}) {
  const { total, items } = await store.listSessions(boardId, { skip: (page - 1) * limit, limit, includeEmpty });
  const sessions = await Promise.all(items.map((s) => withCounters(store, s)));
  const rows = await store.listParticipants(sessions.map((s) => s.id));
  const directory = await userDirectory(store, rows);
  const bySession = new Map();
  for (const row of rows) {
    const user = directory.get(row.userId);
    if (!user) continue;
    const list = bySession.get(row.sessionId) ?? new Map();
    list.set(user.id, user);
    bySession.set(row.sessionId, list);
  }
  return {
    items: sessions.map((s) => serialize(s, [...(bySession.get(s.id)?.values() ?? [])])),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/** One session plus each participant's join/leave intervals (needed to show who was present when). */
export async function getSession(store, boardId, sessionId) {
  const session = await mustGetSession(store, boardId, sessionId);
  const rows = await store.listParticipants([session.id]);
  const directory = await userDirectory(store, rows);
  const startedAt = +new Date(session.startedAt);
  const intervals = rows
    .filter((r) => directory.has(r.userId))
    .map((r) => ({
      userId: r.userId,
      name: directory.get(r.userId).name,
      color: directory.get(r.userId).color,
      joinedMs: Math.max(0, +new Date(r.joinedAt) - startedAt),
      leftMs: r.leftAt ? Math.max(0, +new Date(r.leftAt) - startedAt) : null, // null = still present
    }));
  const unique = new Map(rows.filter((r) => directory.has(r.userId)).map((r) => [r.userId, directory.get(r.userId)]));
  return { ...serialize(session, [...unique.values()]), presence: intervals };
}

/**
 * A page of the session's changes in sequence order, in the same op shape the live editor applies,
 * plus `seq`, `at` (server time, ms since epoch) and `userId`. Cursor-paged by sequence.
 */
export async function listSessionEvents(store, boardId, sessionId, { after = 0, limit = 300 } = {}) {
  const session = await mustGetSession(store, boardId, sessionId);
  const rows = await store.listSessionEvents(session.id, after, limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const events = page.map((e) => ({ seq: e.sequence, at: +new Date(e.createdAt), userId: String(e.userId), ...eventToOp(e) }));
  return { events, hasMore, nextAfter: page.length ? page.at(-1).sequence : after };
}

/**
 * The board as it looked `offsetMs` after the session started (clamped to the session's length):
 * the state after the last change recorded at or before that moment. `sequence` tells the caller
 * where to continue paging events from.
 */
export async function stateAtOffset(store, boardId, sessionId, offsetMs = 0) {
  const session = await mustGetSession(store, boardId, sessionId);
  const startedAt = +new Date(session.startedAt);
  const duration = (session.endedAt ? +new Date(session.endedAt) : Date.now()) - startedAt;
  const offset = clamp(offsetMs, 0, Math.max(0, duration));
  const last = await store.findLastEventAtOrBefore(session.id, new Date(startedAt + offset));
  const sequence = last ? last.sequence : session.startSequence;
  const { objects, snapshotSequence, replayed } = await stateAtSequence(store, boardId, sequence);
  return { sequence, offsetMs: last ? Math.max(0, +new Date(last.createdAt) - startedAt) : 0, objects, snapshotSequence, replayed };
}
