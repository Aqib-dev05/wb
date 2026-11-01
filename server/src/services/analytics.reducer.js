import { OP } from './boardState.js';

// Turns a board's recorded events into interaction metrics. Pure: no I/O, no clock, no randomness
// (the caller passes `now`), so every number can be checked against a hand-computed fixture.
//
// Everything here is a COUNT OF RECORDED CHANGES (create / update / delete / reorder operations
// accepted by the server). It says nothing about attention, reading time or "engagement": people
// who only watch the board leave no events. Cursor movement and drag previews are never stored,
// so they are not counted either.

export const ANALYTICS_VERSION = 1; // bump when the shape or the maths change: cached aggregates are rebuilt
export const QUARTER_MS = 15 * 60 * 1000; // time buckets are 15 min so every real UTC offset lands on a boundary
export const SERIES_DAYS = 90; // how far back the time series is kept (totals cover the whole history)
export const HEAT_CELL = 100; // heatmap cell edge in board (scene) pixels
export const HEAT_MAX_CELLS = 5_000; // busiest cells kept; the rest are summed into `hiddenCells`
const DAY_MS = 24 * 60 * 60 * 1000;
const SLOTS = 96; // quarter-hours in a day

export const OP_KEYS = { [OP.CREATED]: 'created', [OP.UPDATED]: 'updated', [OP.DELETED]: 'deleted', [OP.REORDERED]: 'reordered' };

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The geometry fields we track per object, so a change that carries no position (a colour change, a delete) can still be located. */
function geometry(source = {}, previous = {}) {
  const next = { ...previous };
  for (const key of ['left', 'top', 'width', 'height', 'scaleX', 'scaleY']) {
    const v = finite(source[key]);
    if (v !== undefined) next[key] = v;
  }
  if (typeof source.originX === 'string') next.originX = source.originX;
  if (typeof source.originY === 'string') next.originY = source.originY;
  return next;
}

/** Approximate centre of an object (rotation is ignored). Returns null when its position is unknown. */
function centre(g) {
  if (!g || g.left === undefined || g.top === undefined) return null;
  const w = Math.abs((g.width ?? 0) * (g.scaleX ?? 1));
  const h = Math.abs((g.height ?? 0) * (g.scaleY ?? 1));
  const x = g.left + (g.originX === 'center' ? 0 : g.originX === 'right' ? -w / 2 : w / 2);
  const y = g.top + (g.originY === 'center' ? 0 : g.originY === 'bottom' ? -h / 2 : h / 2);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

const blankCounts = () => ({ created: 0, updated: 0, deleted: 0, reordered: 0 });

export class AnalyticsAccumulator {
  constructor() {
    this.events = 0;
    this.lastSequence = 0;
    this.firstAt = null;
    this.lastAt = null;
    this.byType = blankCounts();
    this.byKind = new Map(); // what people created: rect, sticky, pen, ...
    this.users = new Map(); // userId -> { ...counts, firstAt, lastAt }
    this.quarters = new Map(); // epoch quarter -> { n, users:Set }
    this.slots = new Array(SLOTS).fill(0); // changes by UTC quarter-hour of day, whole history
    this.objects = new Map(); // objectId -> geometry (only to locate later changes)
    this.heat = new Map(); // "cx,cy" -> count
    this.located = 0;
    this.unlocated = 0;
  }

  /** `event`: { sequence, type, objectId, payload, userId, createdAt }. Feed them in sequence order. */
  add(event) {
    const key = OP_KEYS[event.type];
    if (!key) return;
    const at = +new Date(event.createdAt);
    if (!Number.isFinite(at)) return;
    const userId = String(event.userId);
    const payload = event.payload ?? {};

    this.events += 1;
    this.lastSequence = Math.max(this.lastSequence, event.sequence ?? 0);
    this.firstAt = this.firstAt === null ? at : Math.min(this.firstAt, at);
    this.lastAt = this.lastAt === null ? at : Math.max(this.lastAt, at);
    this.byType[key] += 1;

    const user = this.users.get(userId) ?? { ...blankCounts(), firstAt: at, lastAt: at };
    user[key] += 1;
    user.firstAt = Math.min(user.firstAt, at);
    user.lastAt = Math.max(user.lastAt, at);
    this.users.set(userId, user);

    const quarter = Math.floor(at / QUARTER_MS);
    const bucket = this.quarters.get(quarter) ?? { n: 0, users: new Set() };
    bucket.n += 1;
    bucket.users.add(userId);
    this.quarters.set(quarter, bucket);
    this.slots[((quarter % SLOTS) + SLOTS) % SLOTS] += 1;

    // Where on the board did this happen? Track each object's last known geometry.
    const id = event.objectId;
    let g;
    if (event.type === OP.CREATED) {
      const obj = payload.object ?? {};
      const kind = typeof obj.kind === 'string' ? obj.kind : typeof obj.type === 'string' ? obj.type : 'unknown';
      this.byKind.set(kind, (this.byKind.get(kind) ?? 0) + 1);
      g = geometry(obj);
      this.objects.set(id, g);
    } else if (event.type === OP.UPDATED) {
      g = this.objects.get(id);
      if (g) {
        g = geometry(payload.patch, g);
        this.objects.set(id, g);
      }
    } else {
      g = this.objects.get(id);
      if (event.type === OP.DELETED) this.objects.delete(id);
    }
    const c = centre(g);
    if (!c) {
      this.unlocated += 1;
      return;
    }
    this.located += 1;
    const cell = `${Math.floor(c.x / HEAT_CELL)},${Math.floor(c.y / HEAT_CELL)}`;
    this.heat.set(cell, (this.heat.get(cell) ?? 0) + 1);
  }

  /** The cacheable result. Plain JSON (arrays and numbers only: no map keys that Mongo could reject). */
  finish(now) {
    const since = Math.floor((now - SERIES_DAYS * DAY_MS) / QUARTER_MS);
    const series = [...this.quarters.entries()]
      .filter(([q]) => q >= since)
      .sort((a, b) => a[0] - b[0])
      .map(([q, b]) => ({ q, n: b.n, u: [...b.users].sort() }));

    const ranked = [...this.heat.entries()]
      .map(([k, count]) => ({ k, count }))
      .sort((a, b) => b.count - a.count || (a.k < b.k ? -1 : 1));
    const kept = ranked.slice(0, HEAT_MAX_CELLS);
    const cells = kept.map(({ k, count }) => {
      const [cx, cy] = k.split(',').map(Number);
      return [cx, cy, count];
    });
    const keptTotal = kept.reduce((s, c) => s + c.count, 0);

    return {
      events: this.events,
      lastSequence: this.lastSequence,
      firstAt: this.firstAt,
      lastAt: this.lastAt,
      byType: { ...this.byType },
      byKind: [...this.byKind.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : 1)),
      users: [...this.users.entries()].map(([id, u]) => ({ id, ...u })).sort((a, b) => b.created + b.updated + b.deleted + b.reordered - (a.created + a.updated + a.deleted + a.reordered) || (a.id < b.id ? -1 : 1)),
      slots: [...this.slots],
      series,
      heat: { cellSize: HEAT_CELL, cells, located: this.located, unlocated: this.unlocated, shown: keptTotal, hidden: this.located - keptTotal },
    };
  }
}

/** Convenience for tests and one-shot use. */
export function reduceEvents(events, now) {
  const acc = new AnalyticsAccumulator();
  for (const e of events) acc.add(e);
  return acc.finish(now);
}
