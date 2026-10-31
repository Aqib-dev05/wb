import { Router } from 'express';
import * as boards from '../controllers/board.controller.js';
import * as members from '../controllers/member.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { addMemberSchema, boardIdSchema, changeRoleSchema, createBoardSchema, listBoardsSchema, memberParams, renameBoardSchema, thumbnailSchema } from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);

router.get('/', validate(listBoardsSchema), boards.list);
router.post('/', validate(createBoardSchema), boards.create);
router.get('/:id', validate(boardIdSchema), boards.get);
router.patch('/:id', validate(renameBoardSchema), boards.rename);
router.delete('/:id', validate(boardIdSchema), boards.remove);

router.get('/:id/state', validate(boardIdSchema), boards.getState);
router.put('/:id/thumbnail', validate(thumbnailSchema), boards.saveThumbnail);

router.get('/:id/members', validate(boardIdSchema), members.list);
router.post('/:id/members', validate(addMemberSchema), members.add);
router.patch('/:id/members/:userId', validate(changeRoleSchema), members.update);
router.delete('/:id/members/:userId', validate(memberParams), members.remove);

export default router;
