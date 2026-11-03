import * as boards from '../services/board.service.js';
import { asyncHandler, ok } from '../utils/http.js';

export const list = asyncHandler(async (req, res) => {
  const { items, meta } = await boards.listBoards(req.user._id, req.query);
  return ok(res, { boards: items }, { meta });
});

export const create = asyncHandler(async (req, res) => {
  const board = await boards.createBoard(req.user._id, req.body.title);
  return ok(res, { board }, { status: 201 });
});

export const get = asyncHandler(async (req, res) => {
  const board = await boards.getBoard(req.params.id, req.user._id);
  return ok(res, { board });
});

export const rename = asyncHandler(async (req, res) => {
  const board = await boards.renameBoard(req.params.id, req.user._id, req.body.title);
  return ok(res, { board });
});

export const remove = asyncHandler(async (req, res) => {
  const id = req.params.id;
  await boards.deleteBoard(id, req.user._id, { beforeDelete: () => req.app.locals.rooms?.destroy(id) });
  req.app.locals.realtime?.closeBoard(id); // tell anyone still on the board
  // A write that was already in flight when the board went away can land a moment later; sweep once more.
  setTimeout(() => boards.sweepBoardData(id).catch((err) => console.error('Late board cleanup failed:', err)), 10_000).unref();
  return ok(res, { deleted: true });
});

// REST read of the live board state (the editor itself joins over the socket instead).
export const getState = asyncHandler(async (req, res) => {
  await boards.getMembership(req.params.id, req.user._id);
  return ok(res, await req.app.locals.rooms.getState(req.params.id));
});

export const saveThumbnail = asyncHandler(async (req, res) => {
  await boards.saveThumbnail(req.params.id, req.user._id, req.body.thumbnail);
  return ok(res, { saved: true });
});
