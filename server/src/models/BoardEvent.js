import mongoose from 'mongoose';

// Append-only log of every accepted operation. `sequence` is assigned by the server and is
// strictly increasing per board (gaps are possible if a write fails after allocation).
// Phase 4 adds sessionId and builds playback/analytics on top of this collection.
const boardEventSchema = new mongoose.Schema(
  {
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    sequence: { type: Number, required: true },
    type: { type: String, required: true, enum: ['object:created', 'object:updated', 'object:deleted', 'object:reordered'] },
    objectId: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    batchId: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { minimize: false, versionKey: false }
);

boardEventSchema.index({ boardId: 1, sequence: 1 }, { unique: true });
boardEventSchema.index({ userId: 1, createdAt: -1 });

export const BoardEvent = mongoose.model('BoardEvent', boardEventSchema);
