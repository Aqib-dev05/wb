import http from 'http';
import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { BoardMember } from './models/BoardMember.js';
import { User } from './models/User.js';
import { RoomManager } from './services/room.service.js';
import { mongoStore } from './services/room.store.mongo.js';
import { verifyAccessToken } from './services/token.service.js';
import { initSockets } from './sockets/index.js';

async function main() {
  await connectDB();

  const rooms = new RoomManager(mongoStore);
  const app = createApp({ rooms });
  const server = http.createServer(app);

  app.locals.realtime = initSockets(server, {
    rooms,
    corsOrigin: env.CLIENT_ORIGIN.split(','),
    async authenticate(token) {
      let payload;
      try {
        payload = verifyAccessToken(token ?? '');
      } catch (err) {
        throw Object.assign(new Error('auth'), { code: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED' });
      }
      const user = await User.findById(payload.sub).select('name color').lean();
      if (!user) throw Object.assign(new Error('auth'), { code: 'UNAUTHORIZED' });
      return { id: String(user._id), name: user.name, color: user.color };
    },
    async getRole(boardId, userId) {
      return (await BoardMember.findOne({ boardId, userId }).select('role').lean())?.role ?? null;
    },
  });
  server.listen(env.PORT, () => console.log(`CollabBoard API listening on :${env.PORT}`));

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down`);
    for (const room of rooms.rooms.values()) await rooms.flush(room); // persist snapshots before exit
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
