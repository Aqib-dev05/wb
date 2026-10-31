import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './routes/auth.routes.js';
import boardRoutes from './routes/board.routes.js';

export function createApp({ rooms } = {}) {
  const app = express();
  app.locals.rooms = rooms; // used by REST handlers that need the live board state
  app.locals.store = rooms?.store; // read-only history/playback queries go through the same store

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN.split(','), credentials: true }));
  // Canvas data travels over the socket; REST bodies are small (the largest is a thumbnail).
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => res.json({ success: true, data: { status: 'ok', uptime: process.uptime() } }));
  app.use('/api/auth', authRoutes);
  app.use('/api/boards', boardRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
