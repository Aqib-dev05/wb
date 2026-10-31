// In-memory implementation of the RoomManager store, used by tests and local UI checks.
export function createMemoryStore() {
  const snapshots = []; // { boardId, sequence, objects }
  const events = [];
  const sequences = new Map();
  return {
    snapshots,
    events,
    failNextInsert: false,
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
      for (const list of [snapshots, events]) for (let i = list.length - 1; i >= 0; i--) if (list[i].boardId === boardId) list.splice(i, 1);
    },
  };
}
