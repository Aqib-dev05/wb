import mongoose from 'mongoose';

// One row per uninterrupted presence of a user in a session: they join (first connection) and
// leave (last connection closed). The same user can appear several times in one session.
const sessionParticipantSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, required: true },
    leftAt: { type: Date, default: null },
  },
  { versionKey: false }
);

sessionParticipantSchema.index({ sessionId: 1, joinedAt: 1 });
sessionParticipantSchema.index({ userId: 1, joinedAt: -1 });

export const SessionParticipant = mongoose.model('SessionParticipant', sessionParticipantSchema);
