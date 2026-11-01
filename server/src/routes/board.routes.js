import { Router } from 'express';
import * as boards from '../controllers/board.controller.js';
import * as members from '../controllers/member.controller.js';
import * as analytics from '../controllers/analytics.controller.js';
import * as playback from '../controllers/playback.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  addMemberSchema, analyticsSchema, boardIdSchema, changeRoleSchema, createBoardSchema, listBoardsSchema, listSessionsSchema, memberParams,
  renameBoardSchema, sessionEventsSchema, sessionIdSchema, sessionStateSchema, thumbnailSchema,
} from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);

router.get('/', validate(listBoardsSchema), boards.list);
router.post('/', validate(createBoardSchema), boards.create);
router.get('/:id', validate(boardIdSchema), boards.get);
router.patch('/:id', validate(renameBoardSchema), boards.rename);
router.delete('/:id', validate(boardIdSchema), boards.remove);

router.get('/:id/state', validate(boardIdSchema), boards.getState);
router.put('/:id/thumbnail', validate(thumbnailSchema), boards.saveThumbnail);

router.get('/:id/sessions', validate(listSessionsSchema), playback.listSessions);
router.get('/:id/sessions/:sessionId', validate(sessionIdSchema), playback.getSession);
router.get('/:id/sessions/:sessionId/events', validate(sessionEventsSchema), playback.listEvents);
router.get('/:id/sessions/:sessionId/state', validate(sessionStateSchema), playback.getState);

router.get('/:id/analytics', validate(analyticsSchema), analytics.get);

router.get('/:id/members', validate(boardIdSchema), members.list);
router.post('/:id/members', validate(addMemberSchema), members.add);
router.patch('/:id/members/:userId', validate(changeRoleSchema), members.update);
router.delete('/:id/members/:userId', validate(memberParams), members.remove);

export default router;
