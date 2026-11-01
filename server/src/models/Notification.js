import mongoose from 'mongoose';

// An in-app notice for one person: they were added to a board, their access changed, or they were
// removed. Board title and actor name are copied in so the notice still reads correctly after the
// board is renamed or the actor changes their name. Notices expire after 90 days.
export const NOTIFICATION_TYPES = ['board_invite', 'role_changed', 'removed'];

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    boardTitle: { type: String, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true },
    actorColor: { type: String },
    role: { type: String, enum: ['viewer', 'editor', 'owner'] },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ boardId: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const Notification = mongoose.model('Notification', notificationSchema);
