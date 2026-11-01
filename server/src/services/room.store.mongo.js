import mongoose from 'mongoose';
import { AnalyticsAggregate } from '../models/AnalyticsAggregate.js';
import { Board } from '../models/Board.js';
import { BoardEvent } from '../models/BoardEvent.js';
import { BoardSnapshot } from '../models/BoardSnapshot.js';
import { Session } from '../models/Session.js';
import { SessionParticipant } from '../models/SessionParticipant.js';
import { User } from '../models/User.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/** Plain, driver-independent session shape shared with tests/helpers/memoryStore.js. */
const toSession = (s) =>
  s && {
    id: String(s._id),
    boardId: String(s.boardId),
    startedAt: s.startedAt,
    endedAt: s.endedAt ?? null,
    endReason: s.endReason ?? null,
    startSequence: s.startSequence ?? 0,
    endSequence: s.endSequence ?? null,
    eventCount: s.eventCount ?? 0,
    lastEventAt: s.lastEventAt ?? null,
  };

const toParticipant = (p) => ({ sessionId: String(p.sessionId), userId: String(p.userId), joinedAt: p.joinedAt, leftAt: p.leftAt ?? null });

/** Count / last sequence / last time of the events recorded for one session. */
async function eventStats(sessionId) {
  const [row] = await BoardEvent.aggregate([
    { $match: { sessionId: oid(sessionId) } },
    { $group: { _id: null, count: { $sum: 1 }, lastSequence: { $max: '$sequence' }, lastEventAt: { $max: '$createdAt' } } },
  ]);
  return { count: row?.count ?? 0, lastSequence: row?.lastSequence ?? null, lastEventAt: row?.lastEventAt ?? null };
}

// The persistence interface RoomManager and playback.service depend on.
// tests/helpers/memoryStore.js implements the same shape.
export const mongoStore = {
  /* ───────────── live board state ───────────── */

  loadLatestSnapshot: (boardId) => BoardSnapshot.findOne({ boardId }).sort({ sequence: -1 }).lean(),

  loadEventsAfter: (boardId, sequence) => BoardEvent.find({ boardId, sequence: { $gt: sequence } }).sort({ sequence: 1 }).lean(),

  /** Atomically reserves `count` consecutive sequence numbers; returns the first. */
  async allocateSequence(boardId, count, userId) {
    const board = await Board.findOneAndUpdate(
      { _id: boardId },
      { $inc: { sequence: count }, $set: { lastModifiedAt: new Date(), lastModifiedBy: userId } },
      { new: true, projection: { sequence: 1 } }
    ).lean();
    if (!board) throw new Error('Board no longer exists');
    return board.sequence - count + 1;
  },

  insertEvents: (events) => BoardEvent.insertMany(events, { ordered: true }),

  saveSnapshot: ({ boardId, sequence, objects, savedBy }) =>
    BoardSnapshot.updateOne({ boardId, sequence }, { $set: { objects, objectCount: objects.length, savedBy } }, { upsert: true }),

  deleteBoardData: (boardId) =>
    Promise.all([
      BoardEvent.deleteMany({ boardId }),
      BoardSnapshot.deleteMany({ boardId }),
      Session.deleteMany({ boardId }),
      SessionParticipant.deleteMany({ boardId }),
      AnalyticsAggregate.deleteMany({ boardId }),
    ]),

  /* ───────────── sessions (written by RoomManager) ───────────── */

  async createSession({ boardId, startedAt, startSequence }) {
    return toSession(await Session.create({ boardId, startedAt, startSequence }));
  },

  endSession: (id, { endedAt, endReason, endSequence, eventCount, lastEventAt }) =>
    Session.updateOne({ _id: id }, { $set: { endedAt, endReason, endSequence, eventCount, lastEventAt } }),

  async addParticipant({ sessionId, boardId, userId, joinedAt }) {
    return String((await SessionParticipant.create({ sessionId, boardId, userId, joinedAt }))._id);
  },

  closeParticipant: (id, leftAt) => SessionParticipant.updateOne({ _id: id }, { $set: { leftAt } }),

  /**
   * Startup repair: a crash can leave sessions open. Their events are intact, so close them using
   * the last recorded activity (a lower bound for the real end) and say so in `endReason`.
   */
  async recoverOpenSessions() {
    const open = await Session.find({ endedAt: null }).lean();
    for (const s of open) {
      const stats = await eventStats(s._id);
      const endedAt = stats.lastEventAt ?? s.startedAt;
      await Session.updateOne(
        { _id: s._id },
        { $set: { endedAt, endReason: 'recovered', endSequence: stats.lastSequence ?? s.startSequence, eventCount: stats.count, lastEventAt: stats.lastEventAt } }
      );
      await SessionParticipant.updateMany({ sessionId: s._id, leftAt: null }, { $set: { leftAt: endedAt } });
    }
    return open.length;
  },

  /* ───────────── history & playback reads ───────────── */

  /** Newest first. Sessions without any recorded change are hidden unless `includeEmpty` (open sessions always show). */
  async listSessions(boardId, { skip = 0, limit = 20, includeEmpty = false } = {}) {
    const filter = { boardId };
    if (!includeEmpty) filter.$or = [{ eventCount: { $gt: 0 } }, { endedAt: null }];
    const [total, rows] = await Promise.all([Session.countDocuments(filter), Session.find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit).lean()]);
    return { total, items: rows.map(toSession) };
  },

  async getSession(boardId, sessionId) {
    return toSession(await Session.findOne({ _id: sessionId, boardId }).lean());
  },

  async getSessionStats(sessionId) {
    return eventStats(sessionId);
  },

  async listParticipants(sessionIds) {
    if (!sessionIds.length) return [];
    return (await SessionParticipant.find({ sessionId: { $in: sessionIds } }).sort({ joinedAt: 1 }).lean()).map(toParticipant);
  },

  listSessionEvents: (sessionId, afterSequence, limit) =>
    BoardEvent.find({ sessionId, sequence: { $gt: afterSequence } }).sort({ sequence: 1 }).limit(limit).lean(),

  findLastEventAtOrBefore: (sessionId, date) => BoardEvent.findOne({ sessionId, createdAt: { $lte: date } }).sort({ createdAt: -1, sequence: -1 }).lean(),

  findSnapshotAtOrBefore: (boardId, sequence) => BoardSnapshot.findOne({ boardId, sequence: { $lte: sequence } }).sort({ sequence: -1 }).lean(),

  /** Events with afterSequence < sequence <= uptoSequence, ascending. */
  findEventsBetween: (boardId, afterSequence, uptoSequence) =>
    BoardEvent.find({ boardId, sequence: { $gt: afterSequence, $lte: uptoSequence } }).sort({ sequence: 1 }).lean(),

  /* ───────────── analytics reads (analytics.service) ───────────── */

  /** The board's current sequence, or null if the board does not exist. */
  async getBoardSequence(boardId) {
    const board = await Board.findById(boardId).select('sequence').lean();
    return board ? board.sequence ?? 0 : null;
  },

  /** Events with afterSequence < sequence <= upToSequence, ascending. Only the fields the reducer reads (big path data stays in the database). */
  listEventsForAnalytics: (boardId, afterSequence, upToSequence, limit) =>
    BoardEvent.find({ boardId, sequence: { $gt: afterSequence, $lte: upToSequence } })
      .select({
        sequence: 1, type: 1, objectId: 1, userId: 1, createdAt: 1,
        'payload.object.type': 1, 'payload.object.kind': 1, 'payload.object.left': 1, 'payload.object.top': 1,
        'payload.object.width': 1, 'payload.object.height': 1, 'payload.object.scaleX': 1, 'payload.object.scaleY': 1,
        'payload.object.originX': 1, 'payload.object.originY': 1,
        'payload.patch.left': 1, 'payload.patch.top': 1, 'payload.patch.width': 1, 'payload.patch.height': 1,
        'payload.patch.scaleX': 1, 'payload.patch.scaleY': 1,
      })
      .sort({ sequence: 1 })
      .limit(limit)
      .lean(),

  async loadAggregate(boardId) {
    const doc = await AnalyticsAggregate.findOne({ boardId }).lean();
    return doc && { version: doc.version, sequence: doc.sequence, computedAt: +new Date(doc.computedAt), data: doc.data };
  },

  saveAggregate: (boardId, { version, sequence, computedAt, data }) =>
    AnalyticsAggregate.updateOne({ boardId }, { $set: { version, sequence, computedAt: new Date(computedAt), data } }, { upsert: true }),

  async listSessionsSince(boardId, sinceMs) {
    return (await Session.find({ boardId, startedAt: { $gte: new Date(sinceMs) } }).select('startedAt endedAt').lean()).map((s) => ({ startedAt: s.startedAt, endedAt: s.endedAt ?? null }));
  },

  /** Every session counts (anyone on the board, with or without edits); a session still open is measured up to `now`. */
  async getSessionTotals(boardId, now) {
    const [row] = await Session.aggregate([
      { $match: { boardId: oid(boardId) } },
      { $group: { _id: null, count: { $sum: 1 }, totalMs: { $sum: { $subtract: [{ $ifNull: ['$endedAt', new Date(now)] }, '$startedAt'] } } } },
    ]);
    return { count: row?.count ?? 0, totalMs: row?.totalMs ?? 0 };
  },

  async findUsers(ids) {
    if (!ids.length) return [];
    return (await User.find({ _id: { $in: ids } }).select('name color').lean()).map((u) => ({ id: String(u._id), name: u.name, color: u.color }));
  },
};
