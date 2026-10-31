// In-memory implementation of the store interface (see src/services/room.store.mongo.js), used by
// tests and local UI checks. It mirrors the Mongo store's behaviour, including result shapes.
export function createMemoryStore({ users = [] } = {}) {
  const snapshots = []; // { boardId, sequence, objects }
  const events = [];
  const sessions = [];
  const participants = [];
  const sequences = new Map();
  let counter = 0;
  const nextId = () => (++counter).toString(16).padStart(24, '0');
  const stats = (sessionId) => {
    const rows = events.filter((e) => e.sessionId === sessionId);
    return {
      count: rows.length,
      lastSequence: rows.length ? Math.max(...rows.map((e) => e.sequence)) : null,
      lastEventAt: rows.length ? new Date(Math.max(...rows.map((e) => +e.createdAt))) : null,
    };
  };

  return {
    snapshots,
    events,
    sessions,
    participants,
    failNextInsert: false,
    failNextSessionCreate: false,

    /* ───────────── live board state ───────────── */

    async loadLatestSnapshot(boardId) {
      return snapshots.filter((s) => s.boardId === boardId).sort((a, b) => b.sequence - a.sequence)[0] ?? null;
    },
    async loadEventsAfter(boardId, sequence) {
      return events.filter((e) => e.boardId === boardId && e.sequence > sequence).sort((a, b) => a.sequence - b.sequence);
    },
    async allocateSequence(boardId, count) {
      const next = (sequences.get(boardId) ?? 0) + count;
      sequences.set(boardId, next);
      return next - count + 1;
    },
    async insertEvents(batch) {
      if (this.failNextInsert) {
        this.failNextInsert = false;
        throw new Error('simulated write failure');
      }
      events.push(...batch.map((e) => structuredClone(e)));
    },
    async saveSnapshot({ boardId, sequence, objects, savedBy }) {
      const i = snapshots.findIndex((s) => s.boardId === boardId && s.sequence === sequence);
      const doc = { boardId, sequence, objects, savedBy };
      if (i === -1) snapshots.push(doc);
      else snapshots[i] = doc;
    },
    async deleteBoardData(boardId) {
      for (const list of [snapshots, events, sessions, participants]) for (let i = list.length - 1; i >= 0; i--) if (list[i].boardId === boardId) list.splice(i, 1);
    },

    /* ───────────── sessions ───────────── */

    async createSession({ boardId, startedAt, startSequence }) {
      if (this.failNextSessionCreate) {
        this.failNextSessionCreate = false;
        throw new Error('simulated session write failure');
      }
      const session = { id: nextId(), boardId, startedAt, endedAt: null, endReason: null, startSequence, endSequence: null, eventCount: 0, lastEventAt: null };
      sessions.push(session);
      return { ...session };
    },
    async endSession(id, patch) {
      Object.assign(sessions.find((s) => s.id === id), patch);
    },
    async addParticipant({ sessionId, boardId, userId, joinedAt }) {
      const row = { id: nextId(), sessionId, boardId, userId, joinedAt, leftAt: null };
      participants.push(row);
      return row.id;
    },
    async closeParticipant(id, leftAt) {
      participants.find((p) => p.id === id).leftAt = leftAt;
    },
    async recoverOpenSessions() {
      const open = sessions.filter((s) => !s.endedAt);
      for (const s of open) {
        const st = stats(s.id);
        s.endedAt = st.lastEventAt ?? s.startedAt;
        s.endReason = 'recovered';
        s.endSequence = st.lastSequence ?? s.startSequence;
        s.eventCount = st.count;
        s.lastEventAt = st.lastEventAt;
        for (const p of participants) if (p.sessionId === s.id && !p.leftAt) p.leftAt = s.endedAt;
      }
      return open.length;
    },

    /* ───────────── history & playback reads ───────────── */

    async listSessions(boardId, { skip = 0, limit = 20, includeEmpty = false } = {}) {
      const rows = sessions
        .filter((s) => s.boardId === boardId && (includeEmpty || s.eventCount > 0 || !s.endedAt))
        .sort((a, b) => +b.startedAt - +a.startedAt);
      return { total: rows.length, items: rows.slice(skip, skip + limit).map((s) => ({ ...s })) };
    },
    async getSession(boardId, sessionId) {
      const s = sessions.find((x) => x.id === sessionId && x.boardId === boardId);
      return s ? { ...s } : null;
    },
    async getSessionStats(sessionId) {
      return stats(sessionId);
    },
    async listParticipants(sessionIds) {
      return participants.filter((p) => sessionIds.includes(p.sessionId)).sort((a, b) => +a.joinedAt - +b.joinedAt).map((p) => ({ ...p }));
    },
    async listSessionEvents(sessionId, afterSequence, limit) {
      return events.filter((e) => e.sessionId === sessionId && e.sequence > afterSequence).sort((a, b) => a.sequence - b.sequence).slice(0, limit);
    },
    async findLastEventAtOrBefore(sessionId, date) {
      return (
        events
          .filter((e) => e.sessionId === sessionId && +e.createdAt <= +date)
          .sort((a, b) => +b.createdAt - +a.createdAt || b.sequence - a.sequence)[0] ?? null
      );
    },
    async findSnapshotAtOrBefore(boardId, sequence) {
      return snapshots.filter((s) => s.boardId === boardId && s.sequence <= sequence).sort((a, b) => b.sequence - a.sequence)[0] ?? null;
    },
    async findEventsBetween(boardId, afterSequence, uptoSequence) {
      return events.filter((e) => e.boardId === boardId && e.sequence > afterSequence && e.sequence <= uptoSequence).sort((a, b) => a.sequence - b.sequence);
    },
    async findUsers(ids) {
      return users.filter((u) => ids.includes(u.id)).map((u) => ({ id: u.id, name: u.name, color: u.color }));
    },
  };
}
