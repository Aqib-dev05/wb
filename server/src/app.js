import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { originGuard } from './middleware/originGuard.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './routes/auth.routes.js';
import boardRoutes from './routes/board.routes.js';
import callRoutes from './routes/call.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import { authStore as mongoAuthStore } from './services/authStore.mongo.js';
import { createLoginThrottle } from './services/loginThrottle.js';
import { createMailer } from './services/mailer.js';
import { hashPassword } from './services/password.js';
import { createPasswordReset } from './services/passwordReset.service.js';
import { createSessionService } from './services/token.service.js';

export function createApp({ rooms, authStore = mongoAuthStore, mailer = createMailer({ smtpUrl: env.SMTP_URL, from: env.MAIL_FROM }), now, forgotMinMs, rateLimits } = {}) {
  const app = express();
  app.locals.rooms = rooms; // used by REST handlers that need the live board state
  app.locals.store = rooms?.store; // read-only history/playback queries go through the same store

  app.locals.auth = {
    store: authStore,
    mailer,
    sessions: createSessionService(authStore, now),
    throttle: createLoginThrottle(authStore, now),
    passwordReset: createPasswordReset({
      store: authStore, mailer, hashPassword, now, secret: env.OTP_SECRET ?? env.JWT_REFRESH_SECRET,
      onPasswordReset: (userId) => app.locals.realtime?.disconnectUser(userId), // cut live sockets of a signed-out account
    }),
    forgotMinMs,
  };

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY); // see TRUST_PROXY in config/env.js
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN.split(','), credentials: true }));
  // Canvas data travels over the socket; REST bodies are small (the largest is a thumbnail).
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(originGuard);
  if (env.NODE_ENV !== 'test') app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => res.json({ success: true, data: { status: 'ok', uptime: process.uptime() } }));
  app.use('/api/auth', authRoutes(rateLimits));
  app.use('/api/boards', boardRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/calls', callRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
