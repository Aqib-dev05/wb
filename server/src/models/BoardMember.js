import mongoose from 'mongoose';

export const ROLES = ['viewer', 'editor', 'owner'];
// Higher index = more privilege. Used by requireBoardRole and, later, socket authorization.
export const roleRank = (role) => ROLES.indexOf(role);

const boardMemberSchema = new mongoose.Schema(
  {
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
    lastOpenedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

boardMemberSchema.index({ boardId: 1, userId: 1 }, { unique: true });
boardMemberSchema.index({ userId: 1, lastOpenedAt: -1 });

export const BoardMember = mongoose.model('BoardMember', boardMemberSchema);
