import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as auth from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, updateProfileSchema } from '../validators/schemas.js';

const limiter = ({ windowMs = 15 * 60 * 1000, limit }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' } },
  });

// A fresh router (and fresh rate-limit counters) per app instance.
export default function authRoutes({ credential = 30, forgot = 5, reset = 10, refresh = 120 } = {}) {
  const router = Router();
  const credentialLimiter = limiter({ limit: credential });
  const forgotLimiter = limiter({ limit: forgot });
  const resetLimiter = limiter({ limit: reset });
  const refreshLimiter = limiter({ limit: refresh });

  router.post('/register', credentialLimiter, validate(registerSchema), auth.register);
  router.post('/login', credentialLimiter, validate(loginSchema), auth.login);
  router.post('/password/forgot', forgotLimiter, validate(forgotPasswordSchema), auth.forgotPassword);
  router.post('/password/reset', resetLimiter, validate(resetPasswordSchema), auth.resetPassword);
  router.post('/refresh', refreshLimiter, auth.refresh);
  router.post('/logout', auth.logout);
  router.get('/me', requireAuth, auth.me);
  router.patch('/me', requireAuth, validate(updateProfileSchema), auth.updateMe);
  return router;
}
