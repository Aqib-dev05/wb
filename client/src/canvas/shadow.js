import { OP, PATCH_KEYS } from './syncKeys.js';

// The "shadow" is the last state this client has committed or received, as plain JSON.
// Diffing the live canvas against it yields the operations to send (and their inverses for undo),
// and remote operations update it so they never show up as local edits.
// Treat stored objects as immutable: history entries keep references to them.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function diffKeys(from, to) {
  const patch = {};
  let changed = false;
  for (const key of PATCH_KEYS) {
    if (!(key in to)) continue;
    if (to.type === 'IText' && (key === 'width' || key === 'height')) continue; // derived from text
    if (!same(from[key], to[key])) {
      patch[key] = to[key];
      changed = true;
    }
  }
  return changed ? patch : null;
}

/** Re-sequences `fromIds` into `toIds` (same members) with "place directly above X" moves. */
function reorderOps(fromIds, toIds) {
  const work = [...fromIds];
  const ops = [];
  toIds.forEach((id, i) => {
    if (work[i] === id) return;
    work.splice(work.indexOf(id), 1);
    work.splice(i, 0, id);
    ops.push({ type: OP.REORDERED, id, afterId: i ? toIds[i - 1] : null });
  });
  return ops;
}

/**
 * Operations that turn state `from` into state `to`. Symmetric, so the inverse of a change is
 * simply transition(to, from). Order matters: reorder survivors first, then create (anchored to the
 * object below, which already exists), then update, then delete.
 */
export function transition(from, to) {
  const ops = [];
  const survivorsFrom = from.order.filter((id) => to.map.has(id));
  const survivorsTo = to.order.filter((id) => from.map.has(id));
  ops.push(...reorderOps(survivorsFrom, survivorsTo));
  to.order.forEach((id, i) => {
    if (!from.map.has(id)) ops.push({ type: OP.CREATED, object: to.map.get(id), afterId: i ? to.order[i - 1] : null });
  });
  for (const id of survivorsTo) {
    const patch = diffKeys(from.map.get(id), to.map.get(id));
    if (patch) ops.push({ type: OP.UPDATED, id, patch });
  }
  for (const id of from.order) if (!to.map.has(id)) ops.push({ type: OP.DELETED, id });
  return ops;
}

function insertId(order, id, afterId) {
  let at = -1;
  if (afterId === null) at = 0;
  else if (typeof afterId === 'string') {
    const i = order.indexOf(afterId);
    if (i !== -1) at = i + 1;
  }
  if (at === -1) order.push(id);
  else order.splice(at, 0, id);
}

export class ShadowState {
  constructor(objects = []) {
    this.reset(objects);
  }

  reset(objects) {
    this.map = new Map(objects.map((o) => [o.id, o]));
    this.order = objects.map((o) => o.id);
  }

  has(id) {
    return this.map.has(id);
  }

  toObjects() {
    return this.order.map((id) => this.map.get(id));
  }

  /** Adopts `current` (z-ordered canonical objects) as the new state; returns what changed. */
  diff(current) {
    const to = { map: new Map(current.map((o) => [o.id, o])), order: current.map((o) => o.id) };
    const forward = transition(this, to);
    const inverse = transition(to, this);
    this.map = to.map;
    this.order = to.order;
    return { forward, inverse };
  }

  /** Mirrors of the server's apply rules, used after a remote/undo op was applied to the canvas. */
  upsert(object, afterId) {
    if (this.map.has(object.id)) {
      this.map.set(object.id, object);
      return;
    }
    this.map.set(object.id, object);
    insertId(this.order, object.id, afterId);
  }

  remove(id) {
    if (!this.map.delete(id)) return;
    this.order.splice(this.order.indexOf(id), 1);
  }

  move(id, afterId) {
    const i = this.order.indexOf(id);
    if (i === -1) return;
    this.order.splice(i, 1);
    insertId(this.order, id, afterId);
  }

  /** Pure apply (no canvas) — used by tests to prove client and server semantics agree. */
  applyOp(op) {
    switch (op.type) {
      case OP.CREATED:
        if (!this.map.has(op.object.id)) this.upsert({ ...op.object }, op.afterId);
        break;
      case OP.UPDATED:
        if (this.map.has(op.id)) this.map.set(op.id, { ...this.map.get(op.id), ...op.patch });
        break;
      case OP.DELETED:
        this.remove(op.id);
        break;
      case OP.REORDERED:
        this.move(op.id, op.afterId);
        break;
      default:
    }
  }
}
