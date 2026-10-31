import mongoose from 'mongoose';

// A point-in-time copy of every object on a board.
// Phase 2 keeps exactly one snapshot per board (sequence 0, overwritten on save).
// Phases 3-4 add server-assigned sequences: snapshots are then taken periodically at
// `sequence = N`, and recovery = latest snapshot + events with sequence > N.
const boardSnapshotSchema = new mongoose.Schema(
  {
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    sequence: { type: Number, required: true, default: 0 },
    objects: { type: [mongoose.Schema.Types.Mixed], default: [] },
    objectCount: { type: Number, default: 0 },
    savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, minimize: false }
);

boardSnapshotSchema.index({ boardId: 1, sequence: -1 }, { unique: true });

export const BoardSnapshot = mongoose.model('BoardSnapshot', boardSnapshotSchema);
