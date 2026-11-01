import { Router } from 'express';
import * as notifications from '../controllers/notification.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listNotificationsSchema, markReadSchema } from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);
router.get('/', validate(listNotificationsSchema), notifications.list);
router.post('/read', validate(markReadSchema), notifications.markRead);

export default router;
