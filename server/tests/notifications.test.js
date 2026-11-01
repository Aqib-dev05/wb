import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as notifications from '../src/services/notification.service.js';
import { BOARD, USERS, once, startServer } from './helpers/harness.js';
import { createMemoryStore } from './helpers/memoryStore.js';

const ada = { id: USERS.ada.id, name: 'Ada', color: USERS.ada.color };
const invite = (over = {}) => ({ userId: USERS.bob.id, actor: ada, type: 'board_invite', boardId: BOARD, boardTitle: 'Roadmap', role: 'editor', ...over });

test('an invite is saved, serialised for the client, and pushed with the new unread count', async () => {
  const store = createMemoryStore();
  const pushed = [];
  const realtime = { notifyUser: (userId, payload) => pushed.push([userId, payload]) };
  const saved = await notifications.notify(store, realtime, invite());
  assert.deepEqual({ ...saved, id: undefined, createdAt: undefined }, {
    id: undefined, type: 'board_invite', boardId: BOARD, boardTitle: 'Roadmap', actor: ada, role: 'editor', createdAt: undefined, read: false,
  });
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0][0], USERS.bob.id);
  assert.equal(pushed[0][1].unread, 1);
  assert.equal(pushed[0][1].notification.id, saved.id);
  assert.equal(store.notifications.length, 1, 'persisted, so an offline person still gets it');
});

test('you are never notified about your own actions (leaving a board, inviting yourself)', async () => {
  const store = createMemoryStore();
  const pushed = [];
  const got = await notifications.notify(store, { notifyUser: (...a) => pushed.push(a) }, invite({ userId: ada.id }));
  assert.equal(got, null);
  assert.equal(store.notifications.length, 0);
  assert.equal(pushed.length, 0);
});

test('list is newest first, paged with a cursor, and only shows the caller\'s own notices', async () => {
  const store = createMemoryStore();
  let t = Date.parse('2026-01-01T00:00:00Z');
  store.now = () => (t += 60_000);
  for (let i = 1; i <= 5; i++) await notifications.notify(store, null, invite({ boardTitle: `B${i}` }));
  await notifications.notify(store, null, invite({ userId: USERS.eve.id, boardTitle: 'not yours' }));

  const first = await notifications.listNotifications(store, USERS.bob.id, { limit: 2 });
  assert.deepEqual(first.notifications.map((n) => n.boardTitle), ['B5', 'B4']);
  assert.equal(first.unread, 5);
  assert.ok(first.nextBefore);
  const second = await notifications.listNotifications(store, USERS.bob.id, { limit: 2, before: first.nextBefore });
  assert.deepEqual(second.notifications.map((n) => n.boardTitle), ['B3', 'B2']);
  const last = await notifications.listNotifications(store, USERS.bob.id, { limit: 2, before: second.nextBefore });
  assert.deepEqual(last.notifications.map((n) => n.boardTitle), ['B1']);
  assert.equal(last.nextBefore, null, 'no further pages');
});

test('mark read: some, all, never someone else\'s, and the unread count follows', async () => {
  const store = createMemoryStore();
  const a = await notifications.notify(store, null, invite({ boardTitle: 'A' }));
  const b = await notifications.notify(store, null, invite({ boardTitle: 'B' }));
  const eves = await notifications.notify(store, null, invite({ userId: USERS.eve.id }));

  assert.deepEqual(await notifications.markRead(store, USERS.bob.id, { ids: [a.id] }), { unread: 1 });
  assert.deepEqual(await notifications.markRead(store, USERS.bob.id, { ids: [eves.id] }), { unread: 1 }, "can't mark another person's notice");
  assert.equal(store.notifications.find((n) => n.id === eves.id).readAt, null);
  assert.deepEqual(await notifications.markRead(store, USERS.bob.id, { all: true }), { unread: 0 });
  assert.equal(store.notifications.find((n) => n.id === eves.id).readAt, null, '"all" is still only your own');
  const list = await notifications.listNotifications(store, USERS.bob.id, {});
  assert.ok(list.notifications.every((n) => n.read));
  await assert.rejects(() => notifications.markRead(store, USERS.bob.id, {}), /Say which/);
  void b;
});

test('deleting a board removes its notifications', async () => {
  const store = createMemoryStore();
  await notifications.notify(store, null, invite());
  await store.deleteBoardData(BOARD);
  assert.equal(store.notifications.length, 0);
});

test('over the wire: only the invited person\'s sockets receive the push (every tab), nobody else', async () => {
  const srv = await startServer();
  try {
    const bob1 = await srv.connect('bob');
    const bob2 = await srv.connect('bob');
    const eve = await srv.connect('eve');
    const got = [once(bob1, 'notification:new'), once(bob2, 'notification:new')];
    let leaked = false;
    eve.on('notification:new', () => { leaked = true; });
    await notifications.notify(srv.store, srv.realtime, invite());
    const [a, b] = await Promise.all(got);
    assert.equal(a.notification.boardTitle, 'Roadmap');
    assert.equal(b.unread, 1);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(leaked, false, "another user's socket must not get it");
  } finally {
    await srv.close();
  }
});
