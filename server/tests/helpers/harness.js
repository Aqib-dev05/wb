import http from 'http';
import { io as connectClient } from 'socket.io-client';
import { RoomManager } from '../../src/services/room.service.js';
import { initSockets } from '../../src/sockets/index.js';
import { createMemoryStore } from './memoryStore.js';

export const BOARD = '507f1f77bcf86cd799439011';
export const USERS = {
  ada: { id: '65a000000000000000000001', name: 'Ada', color: '#5B4BFF' },
  bob: { id: '65a000000000000000000002', name: 'Bob', color: '#FF6B57' },
  eve: { id: '65a000000000000000000003', name: 'Eve', color: '#2FCB8E' }, // not a member
  vic: { id: '65a000000000000000000004', name: 'Vic', color: '#F5A524' }, // viewer
};
export const ROLES = { ada: 'owner', bob: 'editor', vic: 'viewer' };

export async function startServer({ store = createMemoryStore(), options } = {}) {
  const rooms = new RoomManager(store, options);
  const server = http.createServer();
  const realtime = initSockets(server, {
    rooms,
    corsOrigin: '*',
    async authenticate(token) {
      if (token === 'expired') throw Object.assign(new Error('x'), { code: 'TOKEN_EXPIRED' });
      const user = Object.values(USERS).find((u) => `tok-${u.name.toLowerCase()}` === token);
      if (!user) throw Object.assign(new Error('x'), { code: 'UNAUTHORIZED' });
      return user;
    },
    async getRole(boardId, userId) {
      const key = Object.keys(USERS).find((k) => USERS[k].id === userId);
      return boardId === BOARD ? ROLES[key] ?? null : null;
    },
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const clients = [];
  return {
    store, rooms, realtime, url,
    async connect(name, token = `tok-${name}`) {
      const socket = connectClient(url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
      clients.push(socket);
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', (e) => reject(e));
      });
      return socket;
    },
    async close() {
      clients.forEach((c) => c.close());
      realtime.io.close();
      await new Promise((r) => server.close(r));
    },
  };
}

export const emit = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
export const once = (socket, event, ms = 1500) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload) => { clearTimeout(t); resolve(payload); });
  });
export const quiet = (ms = 120) => new Promise((r) => setTimeout(r, ms));
export const rect = (id, extra = {}) => ({ id, type: 'Rect', kind: 'rect', left: 0, top: 0, width: 10, height: 10, fill: '#fff', ...extra });
export const create = (id, extra, afterId) => ({ type: 'object:created', object: rect(id, extra), ...(afterId !== undefined ? { afterId } : {}) });
let n = 0;
export const batch = (ops, boardId = BOARD) => ({ boardId, batchId: `b${++n}`, ops });
