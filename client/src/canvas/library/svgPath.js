// Turns the SVG that icon sets ship into ONE path string, because the board stores every library
// item as a plain Path object (the same type the pen tool makes), so it syncs, replays, exports and
// restyles like everything else, and the server needs no new object type.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const f = (n) => String(+n.toFixed(3));

function ellipsePath(cx, cy, rx, ry) {
  return `M${f(cx - rx)} ${f(cy)}a${f(rx)} ${f(ry)} 0 1 0 ${f(rx * 2)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-rx * 2)} 0z`;
}

function rectPath({ x = 0, y = 0, width = 0, height = 0, rx, ry }) {
  [x, y, width, height] = [num(x), num(y), num(width), num(height)];
  // SVG rule: a missing radius copies the other one; both are capped at half the side.
  let rX = rx === undefined ? (ry === undefined ? 0 : num(ry)) : num(rx);
  let rY = ry === undefined ? rX : num(ry);
  rX = Math.min(rX, width / 2);
  rY = Math.min(rY, height / 2);
  if (!rX || !rY) return `M${f(x)} ${f(y)}H${f(x + width)}V${f(y + height)}H${f(x)}z`;
  return (
    `M${f(x + rX)} ${f(y)}H${f(x + width - rX)}A${f(rX)} ${f(rY)} 0 0 1 ${f(x + width)} ${f(y + rY)}` +
    `V${f(y + height - rY)}A${f(rX)} ${f(rY)} 0 0 1 ${f(x + width - rX)} ${f(y + height)}` +
    `H${f(x + rX)}A${f(rX)} ${f(rY)} 0 0 1 ${f(x)} ${f(y + height - rY)}` +
    `V${f(y + rY)}A${f(rX)} ${f(rY)} 0 0 1 ${f(x + rX)} ${f(y)}z`
  );
}

function pointsPath(points, close) {
  const nums = String(points).trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (nums.length < 4 || nums.some((n) => !Number.isFinite(n))) return '';
  let d = '';
  for (let i = 0; i + 1 < nums.length; i += 2) d += `${i ? 'L' : 'M'}${f(nums[i])} ${f(nums[i + 1])}`;
  return close ? `${d}z` : d;
}

/** One element of a Lucide icon node ([tag, attributes]) as path data; '' for anything unknown. */
export function elementToPath([tag, a = {}]) {
  switch (tag) {
    case 'path':
      return typeof a.d === 'string' ? a.d : '';
    case 'circle':
      return ellipsePath(num(a.cx), num(a.cy), num(a.r), num(a.r));
    case 'ellipse':
      return ellipsePath(num(a.cx), num(a.cy), num(a.rx), num(a.ry));
    case 'rect':
      return rectPath(a);
    case 'line':
      return `M${f(num(a.x1))} ${f(num(a.y1))}L${f(num(a.x2))} ${f(num(a.y2))}`;
    case 'polyline':
      return pointsPath(a.points, false);
    case 'polygon':
      return pointsPath(a.points, true);
    default:
      return '';
  }
}

/** A whole Lucide icon (array of elements) as a single path string. */
export const iconNodeToPath = (node) => node.map(elementToPath).filter(Boolean).join(' ');

/** The path of a Simple Icons SVG file (they contain exactly one <path d="...">). */
export function svgToPath(svg) {
  const paths = [...String(svg).matchAll(/<path\b[^>]*?\sd="([^"]+)"/g)].map((m) => m[1]);
  return paths.join(' ');
}
