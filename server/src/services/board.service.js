import mongoose from 'mongoose';
import { Board } from '../models/Board.js';
import { BoardEvent } from '../models/BoardEvent.js';
import { BoardSnapshot } from '../models/BoardSnapshot.js';
import { BoardMember, roleRank } from '../models/BoardMember.js';
import { Session } from '../models/Session.js';
import { SessionParticipant } from '../models/SessionParticipant.js';
import { ApiError } from '../utils/ApiError.js';
import { escapeRegex } from '../utils/http.js';

const OWNER_FIELDS = 'name color';

/** Returns the caller's membership for a board or throws 404 (hides existence from non-members). */
export async function getMembership(boardId, userId) {
  if (!mongoose.isValidObjectId(boardId)) throw ApiError.notFound('Board not found');
  const membership = await BoardMember.findOne({ boardId, userId });
  if (!membership) throw ApiError.notFound('Board not found');
  return membership;
}

export async function assertBoardRole(boardId, userId, minRole) {
  const membership = await getMembership(boardId, userId);
  if (roleRank(membership.role) < roleRank(minRole)) {
    throw ApiError.forbidden(`This action requires ${minRole} access`);
  }
  return membership;
}

async function memberSummaries(boardIds) {
  if (boardIds.length === 0) return new Map();
  const rows = await BoardMember.aggregate([
    { $match: { boardId: { $in: boardIds } } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: '$boardId', count: { $sum: 1 }, userIds: { $push: '$userId' } } },
    { $project: { count: 1, userIds: { $slice: ['$userIds', 4] } } },
  ]);
  const userIds = [...new Set(rows.flatMap((r) => r.userIds.map(String)))];
  const users = await mongoose.model('User').find({ _id: { $in: userIds } }).select(OWNER_FIELDS).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return new Map(
    rows.map((r) => [
      String(r._id),
      {
        count: r.count,
        preview: r.userIds.map((id) => byId.get(String(id))).filter(Boolean).map((u) => ({ id: String(u._id), name: u.name, color: u.color })),
      },
    ])
  );
}

function serializeBoard(board, membership, summary) {
  const owner = board.ownerId && board.ownerId.name ? board.ownerId : null;
  return {
    id: String(board._id),
    title: board.title,
    thumbnail: board.thumbnail,
    owner: owner ? { id: String(owner._id), name: owner.name, color: owner.color } : { id: String(board.ownerId) },
    role: membership.role,
    lastModifiedAt: board.lastModifiedAt,
    lastOpenedAt: membership.lastOpenedAt,
    createdAt: board.createdAt,
    memberCount: summary?.count ?? 1,
    members: summary?.preview ?? [],
  };
}

/**
 * Lists boards the user belongs to. `scope`: all | owned | shared | recent.
 * Search matches the title case-insensitively.
 */
export async function listBoards(userId, { q, scope = 'all', page = 1, limit = 24 }) {
  const memberFilter = { userId };
  if (scope === 'owned') memberFilter.role = 'owner';
  if (scope === 'shared') memberFilter.role = { $ne: 'owner' };
  if (scope === 'recent') memberFilter.lastOpenedAt = { $ne: null };

  const memberships = await BoardMember.find(memberFilter).lean();
  const membershipByBoard = new Map(memberships.map((m) => [String(m.boardId), m]));

  const boardFilter = { _id: { $in: memberships.map((m) => m.boardId) } };
  if (q) boardFilter.title = { $regex: escapeRegex(q), $options: 'i' };

  const sort = scope === 'recent' ? { lastModifiedAt: -1 } : { lastModifiedAt: -1 };
  const [total, boards] = await Promise.all([
    Board.countDocuments(boardFilter),
    Board.find(boardFilter).sort(sort).skip((page - 1) * limit).limit(limit).populate('ownerId', OWNER_FIELDS).lean(),
  ]);

  let items = boards;
  if (scope === 'recent') {
    items = [...boards].sort((a, b) => new Date(membershipByBoard.get(String(b._id)).lastOpenedAt) - new Date(membershipByBoard.get(String(a._id)).lastOpenedAt));
  }

  const summaries = await memberSummaries(items.map((b) => b._id));
  return {
    items: items.map((b) => serializeBoard(b, membershipByBoard.get(String(b._id)), summaries.get(String(b._id)))),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function createBoard(userId, title) {
  const board = await Board.create({ title, ownerId: userId, lastModifiedBy: userId });
  try {
    await BoardMember.create({ boardId: board._id, userId, role: 'owner', lastOpenedAt: new Date() });
  } catch (err) {
    await Board.deleteOne({ _id: board._id }); // never leave an ownerless board behind
    throw err;
  }
  return getBoard(board._id, userId, { touch: false });
}

export async function getBoard(boardId, userId, { touch = true } = {}) {
  const membership = await getMembership(boardId, userId);
  if (touch) {
    membership.lastOpenedAt = new Date();
    await membership.save();
  }
  const board = await Board.findById(boardId).populate('ownerId', OWNER_FIELDS).lean();
  if (!board) throw ApiError.notFound('Board not found');
  const summaries = await memberSummaries([board._id]);
  return serializeBoard(board, membership, summaries.get(String(board._id)));
}

export async function renameBoard(boardId, userId, title) {
  await assertBoardRole(boardId, userId, 'editor');
  await Board.updateOne({ _id: boardId }, { $set: { title, lastModifiedAt: new Date(), lastModifiedBy: userId } });
  return getBoard(boardId, userId, { touch: false });
}

export async function deleteBoard(boardId, userId) {
  await assertBoardRole(boardId, userId, 'owner');
  await Promise.all([
    Board.deleteOne({ _id: boardId }),
    BoardMember.deleteMany({ boardId }),
    BoardSnapshot.deleteMany({ boardId }),
    BoardEvent.deleteMany({ boardId }),
    Session.deleteMany({ boardId }),
    SessionParticipant.deleteMany({ boardId }),
  ]);
}

/** Any member may update the preview image used on the dashboard. Editors and owners only. */
export async function saveThumbnail(boardId, userId, thumbnail) {
  await assertBoardRole(boardId, userId, 'editor');
  await Board.updateOne({ _id: boardId }, { $set: { thumbnail } });
}
