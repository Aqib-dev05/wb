import { Board } from '../models/Board.js';
import { BoardEvent } from '../models/BoardEvent.js';
import { BoardSnapshot } from '../models/BoardSnapshot.js';

// The persistence interface RoomManager depends on. tests/helpers/memoryStore.js implements the same shape.
export const mongoStore = {
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

  deleteBoardData: (boardId) => Promise.all([BoardEvent.deleteMany({ boardId }), BoardSnapshot.deleteMany({ boardId })]),
};
