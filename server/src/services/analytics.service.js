import { ApiError } from '../utils/ApiError.js';
import { ANALYTICS_VERSION, AnalyticsAccumulator, QUARTER_MS, SERIES_DAYS } from './analytics.reducer.js';

// Builds the analytics response for one board. History is reduced once and cached (see
// models/AnalyticsAggregate.js); the parts that depend on the viewer's timezone, the window and
// the sessions collection are assembled per request from that cache, which is cheap.

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 5_000;
const SLOTS = 96;
const CACHE_MAX_AGE_MS = DAY_MS; // the time series is windowed from "now", so even an unchanged board is rebuilt daily
const DEFAULT_MAX_STALE_MS = 5_000; // a busy board is not re-reduced on every request

const inflight = new WeakMap(); // store -> Map(boardId -> Promise): concurrent requests share one recompute

/** YYYY-MM-DD of `ms` on a clock `tz` minutes east of UTC. */
export const localDate = (ms, tz) => new Date(ms + tz * 60_000).toISOString().slice(0, 10);

async function recompute(store, boardId, upTo, now) {
  const acc = new AnalyticsAccumulator();
  let after = 0;
  for (;;) {
    const rows = await store.listEventsForAnalytics(boardId, after, upTo, PAGE);
    for (const row of rows) acc.add(row);
    if (rows.length < PAGE) break;
    after = rows[rows.length - 1].sequence;
  }
  const aggregate = { version: ANALYTICS_VERSION, sequence: upTo, computedAt: now, data: acc.finish(now) };
  await store.saveAggregate(boardId, aggregate);
  return aggregate;
}

async function loadAggregate(store, boardId, { now, maxStaleMs }) {
  const sequence = await store.getBoardSequence(boardId);
  if (sequence === null) throw ApiError.notFound('Board not found');
  const cached = await store.loadAggregate(boardId);
  if (cached && cached.version === ANALYTICS_VERSION) {
    const age = now - cached.computedAt;
    const upToDate = cached.sequence === sequence;
    if (age <= CACHE_MAX_AGE_MS && (upToDate || age <= maxStaleMs)) return { ...cached, stale: !upToDate };
  }
  const running = inflight.get(store) ?? new Map();
  inflight.set(store, running);
  let job = running.get(boardId);
  if (!job) {
    job = recompute(store, boardId, sequence, now).finally(() => running.delete(boardId));
    running.set(boardId, job);
  }
  return { ...(await job), stale: false };
}

/** Local-hour histogram (24 numbers) from the 96 UTC quarter-hour slots. `tz` must be a multiple of 15. */
function hoursOfDay(slots, tz) {
  const hours = new Array(24).fill(0);
  slots.forEach((count, slot) => {
    const minute = (((slot * 15 + tz) % 1440) + 1440) % 1440;
    hours[Math.floor(minute / 60)] += count;
  });
  return hours;
}

/**
 * @param tz minutes east of UTC (e.g. Pakistan = 300); decides what "today" and "hour of day" mean
 * @param days length of the daily series (ending today)
 */
export async function getAnalytics(store, boardId, { tz = 0, days = 30, now = Date.now(), maxStaleMs = DEFAULT_MAX_STALE_MS } = {}) {
  const aggregate = await loadAggregate(store, boardId, { now, maxStaleMs });
  const { data } = aggregate;

  // Daily series, zero-filled so "nothing happened" is visible rather than missing.
  const today = localDate(now, tz);
  const dates = [];
  for (let i = days - 1; i >= 0; i--) dates.push(localDate(now - i * DAY_MS, tz));
  const day = new Map(dates.map((date) => [date, { date, changes: 0, people: new Set(), sessions: 0 }]));
  for (const bucket of data.series) {
    const row = day.get(localDate(bucket.q * QUARTER_MS, tz));
    if (!row) continue;
    row.changes += bucket.n;
    bucket.u.forEach((id) => row.people.add(id));
  }
  const since = now - (days + 1) * DAY_MS;
  for (const s of await store.listSessionsSince(boardId, since)) {
    const row = day.get(localDate(+new Date(s.startedAt), tz));
    if (row) row.sessions += 1;
  }
  const sessionTotals = await store.getSessionTotals(boardId, now);

  const directory = new Map((await store.findUsers(data.users.map((u) => u.id))).map((u) => [u.id, u]));
  const total = data.events || 1;
  const users = data.users.map((u) => {
    const known = directory.get(u.id);
    const changes = u.created + u.updated + u.deleted + u.reordered;
    return {
      id: u.id,
      name: known?.name ?? 'Former member',
      color: known?.color ?? '#8D92A8',
      changes,
      created: u.created,
      updated: u.updated,
      deleted: u.deleted,
      reordered: u.reordered,
      share: changes / total,
      firstAt: u.firstAt,
      lastAt: u.lastAt,
    };
  });

  const cells = data.heat.cells;
  const bounds = cells.length
    ? {
        minX: Math.min(...cells.map((c) => c[0])),
        maxX: Math.max(...cells.map((c) => c[0])),
        minY: Math.min(...cells.map((c) => c[1])),
        maxY: Math.max(...cells.map((c) => c[1])),
      }
    : null;

  return {
    asOf: { sequence: aggregate.sequence, computedAt: new Date(aggregate.computedAt).toISOString(), stale: aggregate.stale },
    window: { days, today, seriesDays: SERIES_DAYS, tz },
    totals: {
      changes: data.events,
      people: users.length,
      sessions: sessionTotals.count,
      sessionMs: sessionTotals.totalMs,
      firstChangeAt: data.firstAt === null ? null : new Date(data.firstAt).toISOString(),
      lastChangeAt: data.lastAt === null ? null : new Date(data.lastAt).toISOString(),
    },
    opsByType: ['created', 'updated', 'deleted', 'reordered'].map((type) => ({ type, count: data.byType[type] })),
    createdByKind: data.byKind,
    users,
    daily: dates.map((date) => {
      const row = day.get(date);
      return { date, changes: row.changes, activePeople: row.people.size, sessions: row.sessions };
    }),
    hours: hoursOfDay(data.slots, tz),
    heatmap: { cellSize: data.heat.cellSize, cells, bounds, located: data.heat.located, unlocated: data.heat.unlocated, shown: data.heat.shown, hidden: data.heat.hidden },
  };
}
