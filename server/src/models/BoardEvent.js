import mongoose from 'mongoose';

// Append-only log of every accepted operation. `sequence` is assigned by the server and is
// strictly increasing per board (gaps are possible if a write fails after allocation).
// `sessionId` (Phase 4) ties each event to the session it happened in; it is null for events
// written before sessions existed, or if the session record could not be created. Playback and
// analytics are built on this collection. `createdAt` is the server's clock, never the client's.
const boardEventSchema = new mongoose.Schema(
  {
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    sequence: { type: Number, required: true },
    type: { type: String, required: true, enum: ['object:created', 'object:updated', 'object:deleted', 'object:reordered'] },
    objectId: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    batchId: { type: String },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { minimize: false, versionKey: false }
);

boardEventSchema.index({ boardId: 1, sequence: 1 }, { unique: true });
boardEventSchema.index({ userId: 1, createdAt: -1 });
boardEventSchema.index({ sessionId: 1, sequence: 1 }); // paginated session history
boardEventSchema.index({ sessionId: 1, createdAt: 1 }); // seek by time within a session

export const BoardEvent = mongoose.model('BoardEvent', boardEventSchema);
