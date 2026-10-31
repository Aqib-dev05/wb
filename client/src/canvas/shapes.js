import { Ellipse, Path, Rect, Triangle } from 'fabric';

const LINE_KINDS = ['line', 'arrow'];
export const isLineKind = (kind) => LINE_KINDS.includes(kind);

// Size used when the user clicks instead of dragging.
const CLICK_SIZE = { w: 140, h: 100, line: 180 };

/** Click (no drag) gets a sensible default size instead of a zero-size object. */
export function defaultEnd(kind, p0) {
  return isLineKind(kind) ? { x: p0.x + CLICK_SIZE.line, y: p0.y } : { x: p0.x + CLICK_SIZE.w, y: p0.y + CLICK_SIZE.h };
}

function bounds(p0, p1, constrain) {
  let w = Math.abs(p1.x - p0.x);
  let h = Math.abs(p1.y - p0.y);
  if (constrain) w = h = Math.max(w, h);
  return {
    left: p1.x < p0.x ? p0.x - w : p0.x,
    top: p1.y < p0.y ? p0.y - h : p0.y,
    width: Math.max(1, w),
    height: Math.max(1, h),
  };
}

function linePath(kind, p0, p1, strokeWidth) {
  let d = `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`;
  if (kind === 'arrow') {
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const head = Math.max(14, strokeWidth * 5);
    const spread = Math.PI / 7;
    const a = { x: p1.x - head * Math.cos(angle - spread), y: p1.y - head * Math.sin(angle - spread) };
    const b = { x: p1.x - head * Math.cos(angle + spread), y: p1.y - head * Math.sin(angle + spread) };
    d += ` M ${a.x} ${a.y} L ${p1.x} ${p1.y} L ${b.x} ${b.y}`;
  }
  return d;
}

/** Builds a (non-added) Fabric object for a drag from p0 to p1. */
export function buildShape(kind, p0, p1, style, constrain = false) {
  const common = { stroke: style.stroke, strokeWidth: style.strokeWidth, opacity: style.opacity, strokeUniform: true, kind };

  if (isLineKind(kind)) {
    return new Path(linePath(kind, p0, p1, style.strokeWidth), {
      ...common,
      fill: null,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    });
  }

  const b = bounds(p0, p1, constrain);
  const filled = { ...common, fill: style.fill, left: b.left, top: b.top };
  if (kind === 'ellipse') return new Ellipse({ ...filled, rx: b.width / 2, ry: b.height / 2 });
  if (kind === 'triangle') return new Triangle({ ...filled, width: b.width, height: b.height, strokeLineJoin: 'round' });
  return new Rect({ ...filled, width: b.width, height: b.height, rx: 4, ry: 4 });
}
