import { Board } from '../models/Board.js';
import * as members from '../services/member.service.js';
import * as notifications from '../services/notification.service.js';
import { asyncHandler, ok } from '../utils/http.js';

/** Tells `userId` what just happened to their access. Best effort: a notification problem must never undo or fail the invite itself. */
async function tell(req, userId, type, role) {
  try {
    const board = await Board.findById(req.params.id).select('title').lean();
    if (!board) return;
    const actor = { id: String(req.user._id), name: req.user.name, color: req.user.color };
    await notifications.notify(req.app.locals.store, req.app.locals.realtime, { userId, actor, type, boardId: req.params.id, boardTitle: board.title, role });
  } catch (err) {
    console.error('Notification failed:', err);
  }
}

export const list = asyncHandler(async (req, res) => ok(res, { members: await members.listMembers(req.params.id, req.user._id) }));

export const add = asyncHandler(async (req, res) => {
  const member = await members.addMember(req.params.id, req.user._id, req.body);
  await tell(req, member.userId, 'board_invite', member.role);
  return ok(res, { member }, { status: 201 });
});

export const update = asyncHandler(async (req, res) => {
  const member = await members.changeRole(req.params.id, req.user._id, req.params.userId, req.body.role);
  await req.app.locals.realtime?.setRole(req.params.id, req.params.userId, member.role);
  await tell(req, req.params.userId, 'role_changed', member.role);
  return ok(res, { member });
});

export const remove = asyncHandler(async (req, res) => {
  await members.removeMember(req.params.id, req.user._id, req.params.userId);
  await req.app.locals.realtime?.kickUser(req.params.id, req.params.userId); // cut live access right away
  await tell(req, req.params.userId, 'removed'); // nothing when someone removes themselves (notify skips your own actions)
  return ok(res, { removed: true });
});
