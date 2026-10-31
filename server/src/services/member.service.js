import { BoardMember } from '../models/BoardMember.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { assertBoardRole, getMembership } from './board.service.js';

const serialize = (m, user, showEmail) => ({
  userId: String(m.userId),
  name: user?.name ?? 'Unknown',
  color: user?.color,
  role: m.role,
  ...(showEmail ? { email: user?.email } : {}),
});

export async function listMembers(boardId, requesterId) {
  const me = await getMembership(boardId, requesterId);
  const members = await BoardMember.find({ boardId }).sort({ createdAt: 1 }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select('name email color').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  // Only the owner sees emails; collaborators see names.
  return members.map((m) => serialize(m, byId.get(String(m.userId)), me.role === 'owner'));
}

export async function addMember(boardId, ownerId, { email, role }) {
  await assertBoardRole(boardId, ownerId, 'owner');
  const user = await User.findOne({ email });
  if (!user) throw ApiError.notFound('No CollabBoard account uses that email. Ask them to sign up first.');
  if (await BoardMember.exists({ boardId, userId: user._id })) throw ApiError.conflict(`${user.name} already has access to this board`);
  const member = await BoardMember.create({ boardId, userId: user._id, role });
  return serialize(member, user, true);
}

export async function changeRole(boardId, ownerId, targetUserId, role) {
  await assertBoardRole(boardId, ownerId, 'owner');
  const target = await BoardMember.findOne({ boardId, userId: targetUserId });
  if (!target) throw ApiError.notFound('That person is not on this board');
  if (target.role === 'owner') throw ApiError.badRequest("The owner's role can't be changed");
  target.role = role;
  await target.save();
  const user = await User.findById(targetUserId).select('name email color').lean();
  return serialize(target, user, true);
}

/** The owner can remove anyone else; any other member can remove themselves (leave the board). */
export async function removeMember(boardId, actorId, targetUserId) {
  const actor = await getMembership(boardId, actorId);
  if (String(actorId) !== String(targetUserId) && actor.role !== 'owner') throw ApiError.forbidden('Only the owner can remove people');
  const target = await BoardMember.findOne({ boardId, userId: targetUserId });
  if (!target) throw ApiError.notFound('That person is not on this board');
  if (target.role === 'owner') throw ApiError.badRequest("The owner can't be removed. Delete the board instead.");
  await target.deleteOne();
}
