import * as members from '../services/member.service.js';
import { asyncHandler, ok } from '../utils/http.js';

export const list = asyncHandler(async (req, res) => ok(res, { members: await members.listMembers(req.params.id, req.user._id) }));

export const add = asyncHandler(async (req, res) => {
  const member = await members.addMember(req.params.id, req.user._id, req.body);
  return ok(res, { member }, { status: 201 });
});

export const update = asyncHandler(async (req, res) => {
  const member = await members.changeRole(req.params.id, req.user._id, req.params.userId, req.body.role);
  await req.app.locals.realtime?.setRole(req.params.id, req.params.userId, member.role);
  return ok(res, { member });
});

export const remove = asyncHandler(async (req, res) => {
  await members.removeMember(req.params.id, req.user._id, req.params.userId);
  await req.app.locals.realtime?.kickUser(req.params.id, req.params.userId); // cut live access right away
  return ok(res, { removed: true });
});
