// Pure, in-memory model of a board's objects plus the rules for applying operations to it.
// No I/O here, so the conflict policy can be unit-tested and, later, swapped for a CRDT.
//
// CONFLICT POLICY (the server's arrival order, i.e. the sequence number, is the total order):
//  - object:updated   merges property by property; for the same property the later sequence wins.
//  - object:deleted   wins over any later update to that object (the update is rejected as "gone").
//  - object:created   with an id that already exists is ignored, so re-sent batches are idempotent.
//  - object:reordered anchors to another object ("place right after X"), so concurrent
//                     creations and reorders never depend on stale array indexes.

export const OP = {
  CREATED: 'object:created',
  UPDATED: 'object:updated',
  DELETED: 'object:deleted',
  REORDERED: 'object:reordered',
};

/** afterId: undefined = on top, null = at the very bottom, string = directly above that object. */
function insertId(order, id, afterId) {
  let at = -1;
  if (afterId === null) at = 0;
  else if (typeof afterId === 'string') {
    const i = order.indexOf(afterId);
    if (i !== -1) at = i + 1; // an anchor that no longer exists falls back to "on top"
  }
  if (at === -1) order.push(id);
  else order.splice(at, 0, id);
}

export class BoardState {
  constructor(objects = [], sequence = 0) {
    this.map = new Map();
    this.order = [];
    this.sequence = sequence;
    for (const o of objects) {
      if (o?.id && !this.map.has(o.id)) {
        this.map.set(o.id, o);
        this.order.push(o.id);
      }
    }
  }

  get size() {
    return this.order.length;
  }

  has(id) {
    return this.map.has(id);
  }

  toObjects() {
    return this.order.map((id) => this.map.get(id));
  }

  /**
   * Dry run: decides which ops of a batch would take effect, without mutating anything.
   * Tracks existence through the batch so "create then update" in one batch is accepted.
   */
  plan(ops) {
    const exists = new Set(this.order);
    const accepted = [];
    const rejected = [];
    ops.forEach((op, index) => {
      const reject = (reason) => rejected.push({ index, reason });
      switch (op.type) {
        case OP.CREATED:
          if (exists.has(op.object.id)) return reject('exists');
          exists.add(op.object.id);
          break;
        case OP.DELETED:
          if (!exists.has(op.id)) return reject('gone');
          exists.delete(op.id);
          break;
        case OP.UPDATED:
        case OP.REORDERED:
          if (!exists.has(op.id)) return reject('gone');
          break;
        default:
          return reject('unknown');
      }
      accepted.push(op);
    });
    return { accepted, rejected };
  }

  /** Applies one op. Safe to call with ops from plan(); returns false if it had no effect. */
  apply(op) {
    switch (op.type) {
      case OP.CREATED: {
        if (this.map.has(op.object.id)) return false;
        this.map.set(op.object.id, { ...op.object });
        insertId(this.order, op.object.id, op.afterId);
        return true;
      }
      case OP.UPDATED: {
        const target = this.map.get(op.id);
        if (!target) return false;
        Object.assign(target, op.patch);
        return true;
      }
      case OP.DELETED: {
        if (!this.map.delete(op.id)) return false;
        this.order.splice(this.order.indexOf(op.id), 1);
        return true;
      }
      case OP.REORDERED: {
        const i = this.order.indexOf(op.id);
        if (i === -1) return false;
        this.order.splice(i, 1);
        insertId(this.order, op.id, op.afterId);
        return true;
      }
      default:
        return false;
    }
  }
}

/** Events are stored with a flat payload; these two functions convert op <-> event shape. */
export function opToEvent(op) {
  switch (op.type) {
    case OP.CREATED:
      return { type: op.type, objectId: op.object.id, payload: { object: op.object, afterId: op.afterId } };
    case OP.UPDATED:
      return { type: op.type, objectId: op.id, payload: { patch: op.patch } };
    case OP.REORDERED:
      return { type: op.type, objectId: op.id, payload: { afterId: op.afterId } };
    default:
      return { type: op.type, objectId: op.id, payload: {} };
  }
}

export function eventToOp(event) {
  const p = event.payload ?? {};
  switch (event.type) {
    case OP.CREATED:
      return { type: OP.CREATED, object: p.object, afterId: p.afterId ?? undefined };
    case OP.UPDATED:
      return { type: OP.UPDATED, id: event.objectId, patch: p.patch };
    case OP.REORDERED:
      return { type: OP.REORDERED, id: event.objectId, afterId: p.afterId };
    default:
      return { type: OP.DELETED, id: event.objectId };
  }
}
