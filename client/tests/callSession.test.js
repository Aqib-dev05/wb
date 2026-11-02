import assert from 'node:assert/strict';
import test from 'node:test';
import { CallSession, mediaErrorMessage } from '../src/calls/CallSession.js';

// ---- fakes: a tiny signalling hub (mirrors the server's rules) and a WebRTC stand-in ----
const tick = () => new Promise((r) => setTimeout(r, 5));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

class FakeTrack { constructor(kind) { this.kind = kind; this.enabled = true; this.readyState = 'live'; } stop() { this.readyState = 'ended'; } }
class FakeStream {
  constructor(tracks = []) { this.tracks = [...tracks]; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
  addTrack(t) { this.tracks.push(t); }
  removeTrack(t) { this.tracks = this.tracks.filter((x) => x !== t); }
}

class FakeSocket {
  constructor(hub, id, user) { this.hub = hub; this.id = id; this.user = user; this.connected = true; this.handlers = new Map(); this.sent = []; }
  on(ev, fn) { (this.handlers.get(ev) ?? this.handlers.set(ev, new Set()).get(ev)).add(fn); }
  off(ev, fn) { this.handlers.get(ev)?.delete(fn); }
  fire(ev, payload) { this.handlers.get(ev)?.forEach((fn) => fn(payload)); }
  emit(ev, payload, ack) { this.sent.push([ev, payload]); this.hub.handle(this, ev, payload, ack); }
}
class Hub {
  constructor({ max = 6 } = {}) { this.members = new Map(); this.sockets = new Map(); this.max = max; }
  socket(id, user) { const s = new FakeSocket(this, id, user); this.sockets.set(id, s); return s; }
  handle(s, ev, p, ack) {
    queueMicrotask(() => {
      if (ev === 'call:join') {
        if (this.members.size >= this.max) return ack({ ok: false, code: 'CALL_FULL', message: 'This call is full' });
        const peers = [...this.members.values()];
        const me = { socketId: s.id, user: s.user, audio: p.audio, video: p.video };
        this.members.set(s.id, me);
        for (const o of peers) this.sockets.get(o.socketId).fire('call:peer-joined', { boardId: p.boardId, peer: me });
        ack({ ok: true, you: s.id, peers });
      } else if (ev === 'call:leave') {
        this.members.delete(s.id);
        for (const o of this.members.values()) this.sockets.get(o.socketId).fire('call:peer-left', { boardId: p.boardId, socketId: s.id });
      } else if (ev === 'call:media') {
        const m = this.members.get(s.id); if (!m) return; Object.assign(m, { audio: p.audio, video: p.video });
        for (const o of this.members.values()) if (o.socketId !== s.id) this.sockets.get(o.socketId).fire('call:media', { boardId: p.boardId, socketId: s.id, audio: p.audio, video: p.video });
      } else if (ev === 'call:signal') {
        if (this.members.has(s.id) && this.members.has(p.to)) this.sockets.get(p.to).fire('call:signal', { boardId: p.boardId, from: s.id, description: p.description, candidate: p.candidate });
      }
    });
  }
}

const allPCs = [];
class FakePC {
  constructor(cfg) {
    this.cfg = cfg; this.transceivers = []; this.id = allPCs.push(this); this.closed = false; this.connectionState = 'new'; this.candidates = []; this.offers = 0;
    this.remoteDescription = null; this.localDescription = null; this.remotePC = null;
  }
  addTransceiver(kind) { const t = { direction: 'sendrecv', receiver: { track: { kind } }, sender: { track: null, replaceTrack: async (tr) => { t.sender.track = tr; } } }; this.transceivers.push(t); if (!this.negotiationQueued) { this.negotiationQueued = true; queueMicrotask(() => { this.negotiationQueued = false; this.onnegotiationneeded?.(); }); } return t; } // like browsers: coalesced
  getTransceivers() { return this.transceivers; }
  async setLocalDescription() {
    const answering = this.remoteDescription?.type === 'offer';
    this.localDescription = { type: answering ? 'answer' : 'offer', sdp: JSON.stringify({ pc: this.id, kinds: this.transceivers.map((t) => t.receiver.track.kind) }) };
    if (!answering) this.offers++;
    if (answering) { this.remotePC = allPCs[JSON.parse(this.remoteDescription.sdp).pc - 1]; this.#connect(); }
  }
  async setRemoteDescription(d) {
    this.remoteDescription = d;
    if (d.type === 'offer') for (const kind of JSON.parse(d.sdp).kinds) this.addIncoming(kind);
    if (d.type === 'answer') { this.remotePC = allPCs[JSON.parse(d.sdp).pc - 1]; this.#connect(); }
  }
  addIncoming(kind) { this.transceivers.push({ direction: 'recvonly', receiver: { track: { kind } }, sender: { track: null, replaceTrack: async function (tr) { this.track = tr; } } }); this.transceivers.at(-1).sender.replaceTrack = async (tr) => { this.transceivers.find((x) => x.receiver.track.kind === kind).sender.track = tr; }; }
  async addIceCandidate(c) { if (!this.remoteDescription) throw new Error('no remote description'); this.candidates.push(c); }
  #connect() {
    for (const pc of [this, this.remotePC]) {
      pc.connectionState = 'connected'; pc.onconnectionstatechange?.();
      const stream = new FakeStream();
      for (const t of pc.transceivers) { const track = new FakeTrack(t.receiver.track.kind); stream.addTrack(track); pc.ontrack?.({ track, streams: [stream] }); }
    }
  }
  restartIce() { this.restarted = true; }
  close() { this.closed = true; this.connectionState = 'closed'; }
}

const user = (name) => ({ id: name, name, color: '#000' });
function setup(hub, id, { media, max } = {}) {
  const socket = hub.socket(id, user(id));
  const sessionHandlers = new Map();
  const session = { socket, on: (ev, fn) => { sessionHandlers.set(ev, fn); return () => sessionHandlers.delete(ev); }, handlers: sessionHandlers };
  const streams = [];
  const call = new CallSession({
    session, boardId: 'b1',
    getIceServers: async () => [{ urls: ['stun:x'] }],
    getUserMedia: media ?? (async (c) => { const s = new FakeStream([...(c.audio ? [new FakeTrack('audio')] : []), ...(c.video ? [new FakeTrack('video')] : [])]); streams.push(s); return s; }),
    PeerConnection: FakePC, MediaStreamCtor: FakeStream, onChange: (snap) => { call.last = snap; },
  });
  return { call, socket, session, streams };
}
const senderTrack = (pc, kind) => pc.transceivers.find((t) => t.receiver.track.kind === kind)?.sender.track ?? null;
const pcOf = (call, id) => call.peers.get(id).pc;

test('two people connect: joiner offers, existing member answers, tracks flow both ways', async () => {
  allPCs.length = 0; const hub = new Hub();
  const a = setup(hub, 'A'), b = setup(hub, 'B');
  assert.deepEqual(await a.call.join({ audio: true, video: true }), { ok: true });
  assert.equal(a.call.status, 'active'); assert.equal(a.call.peers.size, 0);
  assert.deepEqual(await b.call.join({ audio: true, video: false }), { ok: true });
  await settle();
  assert.equal(a.call.peers.size, 1); assert.equal(b.call.peers.size, 1);
  const [pa, pb] = [pcOf(a.call, 'B'), pcOf(b.call, 'A')];
  assert.equal(pb.offers, 1, 'the joiner made the offer'); assert.equal(pa.offers, 0, 'the existing member only answered');
  assert.equal(pa.connectionState, 'connected'); assert.equal(pb.connectionState, 'connected');
  assert.equal(senderTrack(pa, 'audio'), a.call.local.getAudioTracks()[0], "A's mic is attached on the answering side");
  assert.equal(senderTrack(pa, 'video'), a.call.local.getVideoTracks()[0], "A's camera is attached on the answering side");
  assert.equal(senderTrack(pb, 'audio'), b.call.local.getAudioTracks()[0]);
  assert.equal(senderTrack(pb, 'video'), null, 'B joined without a camera');
  assert.ok(a.call.last.peers[0].stream && b.call.last.peers[0].stream, 'both sides received remote media');
  assert.equal(a.call.last.peers[0].user.name, 'B'); assert.equal(b.call.last.peers[0].user.name, 'A');
  assert.deepEqual(pb.cfg.iceServers, [{ urls: ['stun:x'] }]);
});

test('a third person offers to both existing members (mesh)', async () => {
  allPCs.length = 0; const hub = new Hub();
  const [a, b, c] = ['A', 'B', 'C'].map((id) => setup(hub, id));
  await a.call.join(); await b.call.join(); await c.call.join(); await settle();
  assert.equal(c.call.peers.size, 2); assert.equal(a.call.peers.size, 2); assert.equal(b.call.peers.size, 2);
  assert.equal([...c.call.peers.values()].filter((p) => p.pc.offers === 1).length, 2);
  assert.ok([a, b, c].every((x) => [...x.call.peers.values()].every((p) => p.pc.connectionState === 'connected')));
});

test('mute keeps the track but silences it; the other side is told; no renegotiation', async () => {
  allPCs.length = 0; const hub = new Hub();
  const a = setup(hub, 'A'), b = setup(hub, 'B');
  await a.call.join(); await b.call.join(); await settle();
  const offersBefore = allPCs.reduce((n, p) => n + p.offers, 0);
  await a.call.setMic(false); await settle();
  assert.equal(a.call.local.getAudioTracks()[0].enabled, false); assert.equal(a.call.mic, false);
  assert.equal(b.call.peers.get('A').audio, false, 'B sees A as muted');
  await a.call.setMic(true); await settle();
  assert.equal(a.call.local.getAudioTracks()[0].enabled, true); assert.equal(b.call.peers.get('A').audio, true);
  assert.equal(allPCs.reduce((n, p) => n + p.offers, 0), offersBefore);
});

test('camera off really stops the camera; camera on swaps a new track into every connection', async () => {
  allPCs.length = 0; const hub = new Hub();
  const a = setup(hub, 'A'), b = setup(hub, 'B'), c = setup(hub, 'C');
  await a.call.join(); await b.call.join(); await c.call.join(); await settle();
  await a.call.setCam(true); await settle();
  const cam1 = a.call.local.getVideoTracks()[0];
  assert.ok(cam1); assert.equal(a.call.cam, true); assert.equal(b.call.peers.get('A').video, true);
  assert.equal(senderTrack(pcOf(a.call, 'B'), 'video'), cam1); assert.equal(senderTrack(pcOf(a.call, 'C'), 'video'), cam1);
  const offers = allPCs.reduce((n, p) => n + p.offers, 0);
  await a.call.setCam(false); await settle();
  assert.equal(cam1.readyState, 'ended', 'the camera light goes out'); assert.equal(a.call.local.getVideoTracks().length, 0);
  assert.equal(senderTrack(pcOf(a.call, 'B'), 'video'), null); assert.equal(b.call.peers.get('A').video, false);
  await a.call.setCam(true); await settle();
  const cam2 = a.call.local.getVideoTracks()[0];
  assert.notEqual(cam2, cam1); assert.equal(senderTrack(pcOf(a.call, 'C'), 'video'), cam2);
  assert.equal(allPCs.reduce((n, p) => n + p.offers, 0), offers, 'no renegotiation was needed');
});

test('a blocked camera does not stop you joining with your microphone', async () => {
  allPCs.length = 0; const hub = new Hub();
  const a = setup(hub, 'A', { media: async (c) => { if (c.video) throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); return new FakeStream([new FakeTrack('audio')]); } });
  const res = await a.call.join({ audio: true, video: true });
  assert.equal(res.ok, true); assert.equal(a.call.status, 'active');
  assert.equal(a.call.mic, true); assert.equal(a.call.cam, false);
  assert.match(a.call.notice, /Camera.*blocked/i);
  assert.equal(a.socket.sent.find(([e]) => e === 'call:join')[1].video, false, 'the server is told the truth');
});

test('no devices at all: you can still join and listen', async () => {
  allPCs.length = 0; const hub = new Hub();
  const a = setup(hub, 'A'), b = setup(hub, 'B', { media: async () => { throw Object.assign(new Error('x'), { name: 'NotFoundError' }); } });
  await a.call.join();
  assert.equal((await b.call.join({ audio: true, video: true })).ok, true); await settle();
  assert.equal(b.call.mic, false); assert.match(b.call.notice, /No .* found/i);
  assert.ok(b.call.last.peers[0].stream, 'B still receives A');
});

test('ICE candidates that arrive early are queued until the remote description is set', async () => {
  allPCs.length = 0; const hub = new Hub();
  const a = setup(hub, 'A'), b = setup(hub, 'B');
  await a.call.join(); await b.call.join();
  // B has sent its offer but A's answer has not come back yet, so B has no remote description
  const pb = pcOf(b.call, 'A');
  assert.equal(pb.remoteDescription, null);
  b.socket.fire('call:signal', { boardId: 'b1', from: 'A', candidate: { candidate: 'early', sdpMid: '0', sdpMLineIndex: 0 } });
  await Promise.resolve();
  assert.equal(b.call.peers.get('A').queued.length, 1, 'held back, not thrown away');
  await settle();
  assert.deepEqual(pb.candidates.map((c) => c.candidate), ['early'], 'applied once the answer arrived');
  assert.equal(b.call.peers.get('A').queued.length, 0);
  b.socket.fire('call:signal', { boardId: 'b1', from: 'A', candidate: { candidate: 'late', sdpMid: '0', sdpMLineIndex: 0 } });
  await settle();
  assert.equal(pb.candidates.length, 2, 'later ones go straight in');
});

test('someone leaving closes their connection; leaving yourself stops every track', async () => {
  allPCs.length = 0; const hub = new Hub();
  const a = setup(hub, 'A'), b = setup(hub, 'B');
  await a.call.join({ audio: true, video: true }); await b.call.join({ audio: true, video: true }); await settle();
  const pa = pcOf(a.call, 'B'); const tracks = a.call.local.getTracks();
  b.call.leave(); await settle();
  assert.equal(a.call.peers.size, 0); assert.equal(pa.closed, true);
  assert.equal(b.call.status, 'idle'); assert.equal(b.call.local, null);
  a.call.leave();
  assert.ok(tracks.every((t) => t.readyState === 'ended')); assert.equal(a.call.status, 'idle');
  assert.ok(a.socket.sent.some(([e]) => e === 'call:leave'));
});

test('a full call is refused cleanly and releases the camera', async () => {
  allPCs.length = 0; const hub = new Hub({ max: 1 });
  const a = setup(hub, 'A'), b = setup(hub, 'B');
  await a.call.join();
  const res = await b.call.join({ audio: true, video: true });
  assert.equal(res.ok, false); assert.match(res.message, /full/);
  assert.equal(b.call.status, 'idle');
  assert.ok(b.streams.flatMap((s) => s.tracks).every((t) => t.readyState === 'ended'), 'no camera left running');
});

test('after a dropped connection the call is closed and rejoined once the board session is live again', async () => {
  allPCs.length = 0; const hub = new Hub();
  const a = setup(hub, 'A'), b = setup(hub, 'B');
  await a.call.join(); await b.call.join(); await settle();
  const old = pcOf(b.call, 'A');
  hub.members.delete('B'); b.socket.fire('disconnect'); // the server forgets B on disconnect
  assert.equal(b.call.status, 'reconnecting'); assert.equal(old.closed, true); assert.equal(b.call.peers.size, 0);
  b.session.handlers.get('status')('live'); await settle();
  assert.equal(b.call.status, 'active'); assert.equal(b.call.peers.size, 1);
  assert.notEqual(pcOf(b.call, 'A'), old); assert.equal(pcOf(b.call, 'A').connectionState, 'connected');
});

test('a failed connection restarts ICE on the offering side only', async () => {
  allPCs.length = 0; const hub = new Hub();
  const a = setup(hub, 'A'), b = setup(hub, 'B');
  await a.call.join(); await b.call.join(); await settle();
  const [pa, pb] = [pcOf(a.call, 'B'), pcOf(b.call, 'A')];
  for (const pc of [pa, pb]) { pc.connectionState = 'failed'; pc.onconnectionstatechange(); }
  assert.equal(pb.restarted, true); assert.equal(pa.restarted, undefined);
  assert.equal(b.call.last.peers[0].state, 'failed');
});

test('signals for another board, from strangers or after leaving are ignored', async () => {
  allPCs.length = 0; const hub = new Hub();
  const a = setup(hub, 'A');
  a.socket.fire('call:signal', { boardId: 'b1', from: 'X', description: { type: 'offer', sdp: '{"pc":1,"kinds":[]}' } });
  await settle(); assert.equal(a.call.peers.size, 0, 'not in a call: ignored');
  await a.call.join();
  a.socket.fire('call:signal', { boardId: 'other', from: 'X', description: { type: 'offer', sdp: '{}' } });
  a.socket.fire('call:signal', { boardId: 'b1', from: 'X', description: { type: 'answer', sdp: '{}' } });
  a.socket.fire('call:peer-joined', { boardId: 'other', peer: { socketId: 'Y', user: user('Y') } });
  await settle(); assert.equal(a.call.peers.size, 0);
});

test('media error messages are specific', () => {
  assert.match(mediaErrorMessage({ name: 'NotAllowedError' }, 'Camera'), /blocked/);
  assert.match(mediaErrorMessage({ name: 'NotFoundError' }, 'Microphone'), /No microphone/);
  assert.match(mediaErrorMessage({ name: 'NotReadableError' }, 'Camera'), /another app/);
});
