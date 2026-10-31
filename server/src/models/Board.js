import mongoose from 'mongoose';

const boardSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Small preview image (data URL or CDN URL). Populated by the editor in Phase 2.
    thumbnail: { type: String, default: null },
    // Last server-assigned operation sequence for this board (Phase 3 uses $inc on this).
    sequence: { type: Number, default: 0 },
    lastModifiedAt: { type: Date, default: Date.now },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

boardSchema.index({ ownerId: 1, lastModifiedAt: -1 });

export const Board = mongoose.model('Board', boardSchema);
