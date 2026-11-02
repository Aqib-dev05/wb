import { createHmac } from 'node:crypto';

// Live video/voice is a WebRTC mesh: every participant connects directly to every other one, so media never
// touches this server. The server only (a) keeps the list of who is in a board's call and (b) relays the
// small signalling messages (offers, answers, ICE candidates) between two members of the same call.
// A mesh sends N-1 uploads per person, which is fine for a small team and not for a webinar, hence the cap.
export const MAX_CALL_PEERS = 6;

/** Who is in which call. Entries are per socket, so one person on two devices counts twice. */
export class CallManager {
  constructor({ maxPeers = MAX_CALL_PEERS } = {}) {
    this.maxPeers = maxPeers;
    this.calls = new Map(); // boardId -> Map(socketId -> peer)
  }

  /** @returns {{ok:true, peers:object[], peer:object} | {ok:false, reason:'full'}} peers = those already in the call */
  join(boardId, socketId, user, media = {}) {
    let call = this.calls.get(boardId);
    if (!call) this.calls.set(boardId, (call = new Map()));
    const existing = call.get(socketId);
    if (existing) return { ok: true, peers: this.others(boardId, socketId), peer: existing };
    if (call.size >= this.maxPeers) return { ok: false, reason: 'full' };
    const peer = { socketId, user, audio: media.audio !== false, video: !!media.video, joinedAt: Date.now() };
    const peers = [...call.values()];
    call.set(socketId, peer);
    return { ok: true, peers, peer };
  }

  /** @returns the peer that left, or null if it wasn't in the call */
  leave(boardId, socketId) {
    const call = this.calls.get(boardId);
    const peer = call?.get(socketId) ?? null;
    if (!peer) return null;
    call.delete(socketId);
    if (!call.size) this.calls.delete(boardId);
    return peer;
  }

  /** Boards this socket is in a call on (used on disconnect). */
  boardsOf(socketId) {
    return [...this.calls].filter(([, call]) => call.has(socketId)).map(([boardId]) => boardId);
  }

  has(boardId, socketId) { return !!this.calls.get(boardId)?.has(socketId); }
  others(boardId, socketId) { return [...(this.calls.get(boardId)?.values() ?? [])].filter((p) => p.socketId !== socketId); }
  size(boardId) { return this.calls.get(boardId)?.size ?? 0; }
  list(boardId) { return [...(this.calls.get(boardId)?.values() ?? [])]; }

  setMedia(boardId, socketId, { audio, video }) {
    const peer = this.calls.get(boardId)?.get(socketId);
    if (!peer) return null;
    if (typeof audio === 'boolean') peer.audio = audio;
    if (typeof video === 'boolean') peer.video = video;
    return peer;
  }
}

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';
const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

/**
 * ICE servers handed to the browser. STUN alone is enough on most home/office networks. Behind strict NATs or
 * corporate firewalls a TURN relay is needed; configure one with TURN_URLS plus either TURN_SECRET (coturn
 * `use-auth-secret`: short-lived credentials are minted here) or a fixed TURN_USERNAME/TURN_CREDENTIAL.
 */
export function iceServersFor(userId, cfg = {}, now = Date.now()) {
  const servers = [{ urls: list(cfg.STUN_URLS).length ? list(cfg.STUN_URLS) : [DEFAULT_STUN] }];
  const turn = list(cfg.TURN_URLS);
  if (turn.length) {
    if (cfg.TURN_SECRET) {
      const username = `${Math.floor(now / 1000) + 3600}:${userId}`; // coturn reads the expiry from the username
      servers.push({ urls: turn, username, credential: createHmac('sha1', cfg.TURN_SECRET).update(username).digest('base64') });
    } else if (cfg.TURN_USERNAME && cfg.TURN_CREDENTIAL) {
      servers.push({ urls: turn, username: cfg.TURN_USERNAME, credential: cfg.TURN_CREDENTIAL });
    }
  }
  return servers;
}
