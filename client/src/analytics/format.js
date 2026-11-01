export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** '2026-03-05' -> "Mar 5". Parsed as UTC and shown as UTC: the string is already a calendar date in the viewer's zone. */
export const formatDay = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const formatHour = (h) => `${String(h).padStart(2, '0')}:00`;
export const formatNumber = (n) => n.toLocaleString();

// "updated" is what the user did: edit/move/restyle an object. The wire name stays object:updated.
export const TYPE_LABELS = { created: 'Created', updated: 'Edited', deleted: 'Deleted', reordered: 'Reordered' };
export const TYPE_COLORS = { created: '#2FCB8E', updated: 'var(--primary)', deleted: '#FF6B57', reordered: '#F5A524' };

const KINDS = { rect: 'Rectangles', ellipse: 'Ellipses', triangle: 'Triangles', line: 'Lines', arrow: 'Arrows', pen: 'Pen strokes', text: 'Text', sticky: 'Sticky notes' };
export const kindLabel = (kind) => KINDS[kind] ?? kind;
