// Runs the API against a throwaway in-memory MongoDB. Handy when no local mongod is installed.
// Usage: npm run dev:memory   (data is lost when the process exits)
import crypto from 'crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = `${mongod.getUri()}collabboard`;
process.env.JWT_ACCESS_SECRET ||= crypto.randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET ||= crypto.randomBytes(32).toString('hex');
console.log(`In-memory MongoDB at ${process.env.MONGODB_URI}`);

await import('../src/server.js');

const stop = async () => {
  await mongod.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
