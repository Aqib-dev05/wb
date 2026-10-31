/** 83000 -> "1:23", 3_723_000 -> "1:02:03". */
export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export const formatStart = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** Who was on the board `time` ms into the session, from their join/leave intervals (each person once). */
export function presentAt(presence = [], time) {
  const seen = new Map();
  for (const p of presence) {
    if (p.joinedMs <= time && (p.leftMs === null || time < p.leftMs)) seen.set(p.userId, { id: p.userId, name: p.name, color: p.color });
  }
  return [...seen.values()];
}
