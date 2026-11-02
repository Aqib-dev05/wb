/**
 * Live video/voice for one board, as a WebRTC mesh (every participant has a direct connection to every other).
 * The server only relays signalling (`call:*` socket events); audio and video never pass through it.
 *
 * How a connection is set up
 *   - Whoever joins the call is the one that sends offers, to everybody already in it. The people already
 *     there just answer. That removes "glare" (two sides offering at once) without extra machinery.
 *   - Every connection always carries one audio and one video transceiver. Mute / camera on-off then only swap
 *     the track inside the sender (replaceTrack), so nothing has to be renegotiated mid-call.
 *   - ICE candidates that arrive before the remote description are queued.
 *   - If a connection fails, the offering side restarts ICE.
 *   - If our socket drops (the server forgets us on disconnect) the peers are closed and, as soon as the board
 *     session is live again, we rejoin.
 *
 * Browser APIs are injected so the logic can be tested with fakes.
 * Status: 'idle' | 'joining' | 'active' | 'reconnecting'
 */
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
// A mesh uploads one copy per participant, so keep each stream modest.
const VIDEO = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } };

export const mediaErrorMessage = (err, what) => {
  const name = err?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return `${what} access is blocked. Allow it in your browser’s site settings to use it.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what.toLowerCase()} was found on this device.`;
  if (name === 'NotReadableError' || name === 'AbortError') return `${what} is being used by another app.`;
  return `Could not start your ${what.toLowerCase()}.`;
};

export class CallSession {
  constructor({ session, boardId, getIceServers, getUserMedia, PeerConnection, MediaStreamCtor = globalThis.MediaStream, onChange = () => {} }) {
    this.session = session;
    this.socket = session.socket;
    this.boardId = boardId;
    this.getIceServers = getIceServers;
    this.getUserMedia = getUserMedia;
    this.PeerConnection = PeerConnection;
    this.MediaStreamCtor = MediaStreamCtor;
    this.onChange = onChange;

    this.status = 'idle';
    this.notice = null; // a non-fatal message, e.g. "camera blocked, joined with audio only"
    this.mic = false;
    this.cam = false;
    this.local = null; // MediaStream with whatever tracks we have
    this.peers = new Map(); // socketId -> { user, audio, video, stream, state, pc, initiator, queued, restarting }
    this.wanted = null; // what we asked for when joining; reused after a reconnect
    this.iceServers = null;
    this.destroyed = false;

    const s = this.socket;
    this.handlers = {
      'call:peer-joined': ({ boardId: b, peer }) => b === boardId && this.#peerJoined(peer),
      'call:peer-left': ({ boardId: b, socketId }) => b === boardId && this.#removePeer(socketId),
      'call:media': ({ boardId: b, socketId, audio, video }) => {
        const p = b === boardId && this.peers.get(socketId);
        if (p) { p.audio = audio; p.video = video; this.#publish(); }
      },
      'call:signal': (msg) => msg.boardId === boardId && this.#onSignal(msg),
      disconnect: () => this.#onDisconnect(),
    };
    for (const [ev, fn] of Object.entries(this.handlers)) s.on(ev, fn);
    this.offStatus = session.on('status', (st) => { if (st === 'live' && this.status === 'reconnecting') this.#rejoin(); });
  }

  snapshot() {
    return {
      status: this.status, notice: this.notice, mic: this.mic, cam: this.cam, local: this.local,
      peers: [...this.peers].map(([socketId, p]) => ({ socketId, user: p.user, audio: p.audio, video: p.video, stream: p.stream, state: p.state })),
    };
  }

  #publish() { if (!this.destroyed) this.onChange(this.snapshot()); }
  #setStatus(status) { this.status = status; this.#publish(); }

  // ---- joining / leaving ----

  /** @returns {Promise<{ok:true} | {ok:false, message:string}>} */
  async join({ audio = true, video = false } = {}) {
    if (this.status !== 'idle') return { ok: true };
    this.wanted = { audio, video };
    this.#setStatus('joining');
    this.notice = null;
    const notices = [];
    this.local = new this.MediaStreamCtor();
    if (audio && video) {
      // One browser prompt for both. If that fails, ask for each on its own so one blocked device doesn't cost us the other.
      const e = await this.#acquire(['audio', 'video']);
      if (e) {
        for (const kind of ['audio', 'video']) { const e2 = await this.#acquire([kind]); if (e2) notices.push(e2); }
      }
    } else {
      if (audio) { const e = await this.#acquire(['audio']); if (e) notices.push(e); }
      if (video) { const e = await this.#acquire(['video']); if (e) notices.push(e); }
    }
    if (this.destroyed || this.status !== 'joining') return { ok: false, message: 'Cancelled' };
    this.notice = notices.join(' ') || null;
    try {
      this.iceServers ??= await this.getIceServers();
    } catch {
      this.iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }]; // still try the common case
    }
    const res = await this.#emitJoin();
    if (!res.ok) { this.#teardown(); return res; }
    this.#setStatus('active');
    return { ok: true };
  }

  #emitJoin() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };
      setTimeout(() => finish({ ok: false, message: 'The server did not answer. Try again.' }), 10_000);
      this.socket.emit('call:join', { boardId: this.boardId, audio: this.mic, video: this.cam }, (res) => {
        if (!res?.ok) return finish({ ok: false, message: res?.message ?? 'Could not join the call' });
        for (const p of res.peers) this.#addPeer(p, true);
        finish({ ok: true });
      });
    });
  }

  leave() {
    if (this.status === 'idle') return;
    if (this.socket.connected) this.socket.emit('call:leave', { boardId: this.boardId });
    this.#teardown();
  }

  destroy() {
    this.leave();
    this.destroyed = true;
    for (const [ev, fn] of Object.entries(this.handlers)) this.socket.off(ev, fn);
    this.offStatus?.();
  }

  #teardown() {
    for (const id of [...this.peers.keys()]) this.#removePeer(id, false);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.mic = false;
    this.cam = false;
    this.wanted = null;
    this.status = 'idle';
    this.#publish();
  }

  // After the socket reconnected and the board was re-joined: the server forgot we were in the call.
  async #rejoin() {
    this.status = 'joining';
    this.#publish();
    const res = await this.#emitJoin();
    if (res.ok) this.#setStatus('active');
    else { this.notice = res.message; this.#teardown(); }
  }

  #onDisconnect() {
    if (this.status === 'idle') return;
    for (const id of [...this.peers.keys()]) this.#removePeer(id, false);
    this.#setStatus('reconnecting');
  }

  // ---- local media ----

  /** Asks the browser for the given kinds. Returns null on success, else a message for the person. */
  async #acquire(kinds) {
    try {
      const constraints = {};
      for (const k of kinds) constraints[k] = k === 'audio' ? AUDIO : VIDEO;
      const stream = await this.getUserMedia(constraints);
      const tracks = stream.getTracks();
      if (this.destroyed || !this.local) { tracks.forEach((t) => t.stop()); return null; }
      for (const kind of kinds) {
        const track = tracks.find((t) => t.kind === kind);
        if (!track) throw Object.assign(new Error('no track'), { name: 'NotFoundError' });
        track.onended = () => this.#trackEnded(kind, track);
        this.local.addTrack(track);
        if (kind === 'audio') this.mic = true; else this.cam = true;
        this.#applyToAll(kind, track);
      }
      return null;
    } catch (err) {
      return mediaErrorMessage(err, kinds.length > 1 ? 'Camera and microphone' : kinds[0] === 'audio' ? 'Microphone' : 'Camera');
    }
  }

  // The device went away (unplugged, permission revoked from the browser UI).
  #trackEnded(kind, track) {
    if (!this.local?.getTracks().includes(track)) return;
    this.local.removeTrack(track);
    if (kind === 'audio') this.mic = false; else this.cam = false;
    this.#applyToAll(kind, null);
    this.notice = `Your ${kind === 'audio' ? 'microphone' : 'camera'} stopped.`;
    this.#sendMedia();
    this.#publish();
  }

  #sender(pc, kind) { return pc.getTransceivers().find((t) => t.receiver?.track?.kind === kind)?.sender ?? null; }
  #applyToAll(kind, track) { for (const p of this.peers.values()) this.#sender(p.pc, kind)?.replaceTrack(track).catch(() => {}); }
  #sendMedia() { if (this.socket.connected) this.socket.emit('call:media', { boardId: this.boardId, audio: this.mic, video: this.cam }); }

  /** Mute / unmute. Without a microphone yet, this asks for one. */
  async setMic(on) {
    if (this.status !== 'active') return;
    const track = this.local?.getAudioTracks()[0];
    if (!track) {
      if (on) { const e = await this.#acquire(['audio']); this.notice = e; }
    } else {
      track.enabled = on; // muted tracks keep sending silence, which avoids renegotiation
      this.mic = on;
    }
    this.#sendMedia();
    this.#publish();
  }

  /** Camera on/off. Off really stops the camera (its light goes out). */
  async setCam(on) {
    if (this.status !== 'active') return;
    if (on && !this.cam) {
      const e = await this.#acquire(['video']);
      this.notice = e;
    } else if (!on && this.cam) {
      const track = this.local.getVideoTracks()[0];
      track?.stop();
      if (track) this.local.removeTrack(track);
      this.#applyToAll('video', null);
      this.cam = false;
      this.notice = null;
    }
    this.#sendMedia();
    this.#publish();
  }

  // ---- peers ----

  #peerJoined(peer) {
    if (this.status === 'idle' || peer.socketId === this.socket.id) return;
    if (!this.peers.has(peer.socketId)) this.#addPeer(peer, false);
  }

  #addPeer(meta, initiator) {
    const { socketId, user, audio, video } = meta;
    const pc = new this.PeerConnection({ iceServers: this.iceServers });
    const peer = { user, audio, video, stream: null, state: 'connecting', pc, initiator, queued: [], restarting: false, closed: false };
    this.peers.set(socketId, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.#signal(socketId, { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
    };
    pc.ontrack = (e) => {
      peer.stream = e.streams?.[0] ?? peer.stream ?? new this.MediaStreamCtor();
      if (!e.streams?.[0] && !peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
      this.#publish();
    };
    pc.onconnectionstatechange = () => {
      if (peer.closed) return;
      peer.state = pc.connectionState;
      if (pc.connectionState === 'failed' && peer.initiator && !peer.restarting) { peer.restarting = true; pc.restartIce?.(); }
      if (pc.connectionState === 'connected') peer.restarting = false;
      this.#publish();
    };
    if (initiator) {
      // The initial offer comes from negotiationneeded, which fires when the transceivers are added (and on restartIce).
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription();
          this.#signal(socketId, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        } catch { /* the connection state handler reports the failure */ }
      };
      for (const kind of ['audio', 'video']) {
        const t = pc.addTransceiver(kind, { direction: 'sendrecv' });
        const track = this.local?.getTracks().find((x) => x.kind === kind);
        if (track) t.sender.replaceTrack(track).catch(() => {});
      }
    }
    this.#publish();
    return peer;
  }

  #removePeer(socketId, publish = true) {
    const peer = this.peers.get(socketId);
    if (!peer) return;
    peer.closed = true;
    try { peer.pc.close(); } catch { /* already closed */ }
    this.peers.delete(socketId);
    if (publish) this.#publish();
  }

  async #onSignal({ from, description, candidate }) {
    if (this.status === 'idle') return;
    try {
      if (description) {
        let peer = this.peers.get(from);
        if (!peer) {
          if (description.type !== 'offer') return;
          peer = this.#addPeer({ socketId: from, user: null, audio: true, video: false }, false);
        }
        const pc = peer.pc;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          // Attach our tracks to the transceivers the offer created, and send media both ways.
          for (const t of pc.getTransceivers()) {
            const kind = t.receiver.track.kind;
            t.direction = 'sendrecv';
            const track = this.local?.getTracks().find((x) => x.kind === kind);
            if (track) t.sender.replaceTrack(track).catch(() => {});
          }
          await pc.setLocalDescription();
          this.#signal(from, { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        }
        for (const c of peer.queued.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (candidate) {
        const peer = this.peers.get(from);
        if (!peer) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate).catch(() => {});
        else peer.queued.push(candidate);
      }
    } catch {
      const peer = this.peers.get(from);
      if (peer) { peer.state = 'failed'; this.#publish(); }
    }
  }

  #signal(to, body) { this.socket.emit('call:signal', { boardId: this.boardId, to, ...body }); }
}
