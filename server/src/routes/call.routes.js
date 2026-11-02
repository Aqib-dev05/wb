import { Router } from 'express';
import * as calls from '../controllers/call.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/ice', calls.iceServers);

export default router;
