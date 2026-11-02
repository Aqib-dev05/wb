import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { BOARD, emit, once, startServer } from './helpers/harness.js';
import { CallManager, iceServersFor } from '../src/services/call.service.js';

const quiet = (socket, event, ms = 250) => new Promise((resolve) => { let got = false; socket.once(event, () => { got = true; }); setTimeout(() => resolve(!got), ms); });
const joinBoard = (s) => emit(s, 'board:join', { boardId: BOARD });

test('CallManager: roster, cap, idempotent join, leave', () => {
  const m = new CallManager({ maxPeers: 2 });
  assert.deepEqual(m.join('b', 's1', { id: 'u1' }).peers, []);
  assert.equal(m.join('b', 's2', { id: 'u2' }).peers.length, 1);
  assert.equal(m.join('b', 's3', { id: 'u3' }).ok, false, 'third person is refused');
  assert.equal(m.join('b', 's2', { id: 'u2' }).ok, true, 'joining twice is harmless');
  assert.equal(m.size('b'), 2);
  assert.ok(m.leave('b', 's1'));
  assert.equal(m.leave('b', 's1'), null);
  assert.equal(m.join('b', 's3', { id: 'u3' }).ok, true, 'a slot freed up');
  m.leave('b', 's2'); m.leave('b', 's3');
  assert.equal(m.calls.has('b'), false, 'empty calls are dropped');
});

test('iceServersFor: STUN default, TURN only when configured, coturn credentials verify', () => {
  assert.deepEqual(iceServersFor('u1', {}).length, 1);
  assert.match(iceServersFor('u1', {})[0].urls[0], /^stun:/);
  assert.equal(iceServersFor('u1', { TURN_URLS: 'turn:t.example:3478' }).length, 1, 'TURN without credentials is not advertised');
  const now = 1_700_000_000_000;
  const [, turn] = iceServersFor('u1', { TURN_URLS: 'turn:t.example:3478,turns:t.example:5349', TURN_SECRET: 's3cret' }, now);
  assert.equal(turn.username, `${now / 1000 + 3600}:u1`);
  assert.equal(turn.credential, createHmac('sha1', 's3cret').update(turn.username).digest('base64'));
  assert.deepEqual(turn.urls, ['turn:t.example:3478', 'turns:t.example:5349']);
  assert.equal(iceServersFor('u1', { TURN_URLS: 'turn:x', TURN_USERNAME: 'a', TURN_CREDENTIAL: 'b' })[1].username, 'a');
});

test('two members join a call, see each other and exchange signalling', async () => {
  const t = await startServer();
  try {
    const [ada, bob] = [await t.connect('ada'), await t.connect('bob')];
    await joinBoard(ada); await joinBoard(bob);
    const first = await emit(ada, 'call:join', { boardId: BOARD, video: true });
    assert.equal(first.ok, true); assert.deepEqual(first.peers, []);
    const joined = once(ada, 'call:peer-joined');
    const second = await emit(bob, 'call:join', { boardId: BOARD, audio: true, video: false });
    assert.equal(second.peers.length, 1);
    assert.equal(second.peers[0].user.name, 'Ada'); assert.equal(second.peers[0].video, true);
    const seen = await joined;
    assert.equal(seen.peer.user.name, 'Bob'); assert.equal(seen.peer.socketId, second.you);

    // offer from bob to ada arrives with bob's socket id as sender; nothing leaks to others
    const gotSignal = once(ada, 'call:signal');
    bob.emit('call:signal', { boardId: BOARD, to: first.you, description: { type: 'offer', sdp: 'v=0\r\n' } });
    const sig = await gotSignal;
    assert.equal(sig.from, second.you); assert.equal(sig.description.type, 'offer');
    const cand = once(bob, 'call:signal');
    ada.emit('call:signal', { boardId: BOARD, to: second.you, candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } });
    assert.equal((await cand).candidate.sdpMid, '0');

    // mute/camera state is relayed
    const media = once(ada, 'call:media');
    bob.emit('call:media', { boardId: BOARD, audio: false, video: true });
    assert.deepEqual(await media, { boardId: BOARD, socketId: second.you, audio: false, video: true });

    const left = once(ada, 'call:peer-left');
    bob.emit('call:leave', { boardId: BOARD });
    assert.equal((await left).socketId, second.you);
  } finally { await t.close(); }
});

test('only people on the board can join; outsiders cannot signal into a call', async () => {
  const t = await startServer();
  try {
    const [ada, eve] = [await t.connect('ada'), await t.connect('eve')];
    await joinBoard(ada);
    const callA = await emit(ada, 'call:join', { boardId: BOARD });
    assert.equal((await emit(eve, 'call:join', { boardId: BOARD })).code, 'NOT_JOINED');
    assert.equal((await joinBoard(eve)).ok, false, 'eve is not a member');
    // eve is not in the call, so her signal to ada is dropped
    const silent = quiet(ada, 'call:signal');
    eve.emit('call:signal', { boardId: BOARD, to: callA.you, description: { type: 'offer', sdp: 'x' } });
    assert.equal(await silent, true);
  } finally { await t.close(); }
});

test('view-only members may join a call; malformed signals are ignored', async () => {
  const t = await startServer();
  try {
    const [ada, vic] = [await t.connect('ada'), await t.connect('vic')];
    await joinBoard(ada); await joinBoard(vic);
    const a = await emit(ada, 'call:join', { boardId: BOARD });
    const v = await emit(vic, 'call:join', { boardId: BOARD });
    assert.equal(v.ok, true);
    const silent = quiet(ada, 'call:signal');
    vic.emit('call:signal', { boardId: BOARD, to: a.you }); // nothing to signal
    vic.emit('call:signal', { boardId: BOARD, to: a.you, description: { type: 'pranswer', sdp: 'x' } });
    vic.emit('call:signal', { boardId: BOARD, to: a.you, description: { type: 'offer', sdp: 'x'.repeat(70_000) } });
    assert.equal(await silent, true);
  } finally { await t.close(); }
});

test('the call is capped, and disconnecting or being removed frees the slot', async () => {
  const t = await startServer();
  try {
    const ada = await t.connect('ada');
    await joinBoard(ada);
    const extra = [];
    for (let i = 0; i < 5; i++) { const s = await t.connect('bob'); await joinBoard(s); extra.push(s); }
    assert.equal((await emit(ada, 'call:join', { boardId: BOARD })).ok, true);
    for (const s of extra) assert.equal((await emit(s, 'call:join', { boardId: BOARD })).ok, true);
    const seventh = await t.connect('bob'); await joinBoard(seventh);
    assert.equal((await emit(seventh, 'call:join', { boardId: BOARD })).code, 'CALL_FULL');

    const left = once(ada, 'call:peer-left');
    extra[0].close();
    await left;
    assert.equal((await emit(seventh, 'call:join', { boardId: BOARD })).ok, true, 'slot reused after a disconnect');

    // removed from the board -> removed from the call
    const gone = once(ada, 'call:peer-left');
    await t.realtime.kickUser(BOARD, '65a000000000000000000002');
    await gone;
    assert.equal(t.realtime.callParticipants(BOARD).filter((p) => p.user.name === 'Bob').length, 0);
  } finally { await t.close(); }
});

test('leaving the board also leaves the call', async () => {
  const t = await startServer();
  try {
    const [ada, bob] = [await t.connect('ada'), await t.connect('bob')];
    await joinBoard(ada); await joinBoard(bob);
    await emit(ada, 'call:join', { boardId: BOARD }); await emit(bob, 'call:join', { boardId: BOARD });
    const left = once(ada, 'call:peer-left');
    bob.emit('board:leave', { boardId: BOARD });
    await left;
    assert.equal(t.realtime.callParticipants(BOARD).length, 1);
  } finally { await t.close(); }
});

test('everyone on the board hears how many people are on the call', async () => {
  const t = await startServer();
  try {
    const [ada, bob, vic] = [await t.connect('ada'), await t.connect('bob'), await t.connect('vic')];
    await joinBoard(ada); await joinBoard(bob);
    const c1 = once(vic, 'call:count'); // vic is on the board but never joins the call
    await joinBoard(vic);
    await emit(ada, 'call:join', { boardId: BOARD });
    assert.deepEqual(await c1, { boardId: BOARD, count: 1 });
    const c2 = once(vic, 'call:count');
    await emit(bob, 'call:join', { boardId: BOARD });
    assert.equal((await c2).count, 2);
    const c3 = once(vic, 'call:count');
    bob.close();
    assert.equal((await c3).count, 1);
    const late = await t.connect('vic');
    assert.equal((await joinBoard(late)).callCount, 1, 'the join ack carries the current count');
  } finally { await t.close(); }
});

test('signalling cannot reach a board member who is not in the call', async () => {
  const t = await startServer();
  try {
    const [ada, bob] = [await t.connect('ada'), await t.connect('bob')];
    await joinBoard(ada); await joinBoard(bob); // bob is on the board but never joins the call
    await emit(ada, 'call:join', { boardId: BOARD });
    const silent = quiet(bob, 'call:signal');
    ada.emit('call:signal', { boardId: BOARD, to: bob.id, description: { type: 'offer', sdp: 'x' } });
    assert.equal(await silent, true);
  } finally { await t.close(); }
});
