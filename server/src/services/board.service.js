import mongoose from 'mongoose';
import { AnalyticsAggregate } from '../models/AnalyticsAggregate.js';
import { Board } from '../models/Board.js';
import { BoardEvent } from '../models/BoardEvent.js';
import { BoardSnapshot } from '../models/BoardSnapshot.js';
import { BoardMember, roleRank } from '../models/BoardMember.js';
import { Notification } from '../models/Notification.js';
import { Session } from '../models/Session.js';
import { SessionParticipant } from '../models/SessionParticipant.js';
import { ApiError } from '../utils/ApiError.js';
import { escapeRegex } from '../utils/http.js';

const OWNER_FIELDS = 'name color';
// Soft caps so one account cannot fill the database or spam invitations.
export const MAX_OWNED_BOARDS = 200;
export const MAX_MEMBERS_PER_BOARD = 50;

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

  let total;
  let items;
  if (scope === 'recent') {
    // "Recent" means most recently OPENED by this person. That order lives on the membership, not the board, so it is applied
    // to the whole match first and only then cut into pages (sorting inside a page would shuffle boards between pages).
    const matching = await Board.find(boardFilter).select('_id').lean();
    const ordered = matching.map((b) => String(b._id)).sort((a, b) => +new Date(membershipByBoard.get(b).lastOpenedAt) - +new Date(membershipByBoard.get(a).lastOpenedAt));
    total = ordered.length;
    const pageIds = ordered.slice((page - 1) * limit, page * limit);
    const boards = await Board.find({ _id: { $in: pageIds } }).populate('ownerId', OWNER_FIELDS).lean();
    const byId = new Map(boards.map((b) => [String(b._id), b]));
    items = pageIds.map((id) => byId.get(id)).filter(Boolean);
  } else {
    let boards;
    [total, boards] = await Promise.all([
      Board.countDocuments(boardFilter),
      Board.find(boardFilter).sort({ lastModifiedAt: -1 }).skip((page - 1) * limit).limit(limit).populate('ownerId', OWNER_FIELDS).lean(),
    ]);
    items = boards;
  }

  const summaries = await memberSummaries(items.map((b) => b._id));
  return {
    items: items.map((b) => serializeBoard(b, membershipByBoard.get(String(b._id)), summaries.get(String(b._id)))),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function createBoard(userId, title) {
  if ((await BoardMember.countDocuments({ userId, role: 'owner' })) >= MAX_OWNED_BOARDS) {
    throw new ApiError(403, 'LIMIT_REACHED', `You can own up to ${MAX_OWNED_BOARDS} boards. Delete one you no longer need first.`);
  }
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

/**
 * Deletes a board and everything hanging off it. `beforeDelete` runs first (the controller stops the live room there so it
 * stops writing). The Board document goes next: from then on no new sequence numbers can be allocated, so no new events
 * can be recorded. Only then is the rest swept.
 */
export async function deleteBoard(boardId, userId, { beforeDelete } = {}) {
  await assertBoardRole(boardId, userId, 'owner');
  beforeDelete?.();
  await Board.deleteOne({ _id: boardId });
  await sweepBoardData(boardId);
}

export async function sweepBoardData(boardId) {
  await Promise.all([
    BoardMember.deleteMany({ boardId }),
    BoardSnapshot.deleteMany({ boardId }),
    BoardEvent.deleteMany({ boardId }),
    Session.deleteMany({ boardId }),
    SessionParticipant.deleteMany({ boardId }),
    AnalyticsAggregate.deleteMany({ boardId }),
    Notification.deleteMany({ boardId }),
  ]);
}

/** Any member may update the preview image used on the dashboard. Editors and owners only. */
export async function saveThumbnail(boardId, userId, thumbnail) {
  await assertBoardRole(boardId, userId, 'editor');
  await Board.updateOne({ _id: boardId }, { $set: { thumbnail } });
}
