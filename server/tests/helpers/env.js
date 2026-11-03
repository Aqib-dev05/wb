// Must be imported BEFORE anything that loads src/config/env.js.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/unused';
process.env.JWT_ACCESS_SECRET ||= 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET ||= 'b'.repeat(40);
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
