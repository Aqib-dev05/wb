import { useEffect, useMemo, useRef, useState } from 'react';
import { formatNumber } from '../../analytics/format.js';
import { useUiStore } from '../../store/uiStore.js';
import { ChartCard } from './ChartCard.jsx';

const MAX_HEIGHT = 440;
const MIN_CELL = 2;
const MAX_CELL = 48;

const rgb = (css) => {
  const hex = css.trim().replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/** Where on the board changes happened: one square per cell, darker = more changes. Drawn on a canvas (up to thousands of cells). */
export function Heatmap({ heatmap }) {
  const theme = useUiStore((s) => s.theme);
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);
  const { cells, bounds, cellSize } = heatmap;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => observer.disconnect();
  }, [bounds]);

  const layout = useMemo(() => {
    if (!bounds) return null;
    const cols = bounds.maxX - bounds.minX + 1;
    const rows = bounds.maxY - bounds.minY + 1;
    const size = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(Math.min((width || 320) / cols, MAX_HEIGHT / rows))));
    const lookup = new Map(cells.map(([x, y, n]) => [`${x},${y}`, n]));
    return { cols, rows, size, lookup, max: Math.max(...cells.map((c) => c[2])) };
  }, [bounds, cells, width]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !layout) return;
    const { cols, rows, size, max } = layout;
    const dpr = window.devicePixelRatio || 1;
    el.width = cols * size * dpr;
    el.height = rows * size * dpr;
    const ctx = el.getContext('2d');
    ctx.scale(dpr, dpr);
    const style = getComputedStyle(document.documentElement);
    const [r, g, b] = rgb(style.getPropertyValue('--primary'));
    const gap = size >= 8 ? 1 : 0;
    for (const [x, y, n] of cells) {
      // sqrt keeps one very busy spot from making every other cell look empty
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.16 + 0.84 * Math.sqrt(n / max)})`;
      ctx.fillRect((x - bounds.minX) * size, (y - bounds.minY) * size, size - gap, size - gap);
    }
  }, [layout, cells, bounds, theme]);

  const total = heatmap.located;
  const top = [...cells].sort((a, b) => b[2] - a[2]).slice(0, 10);
  const area = ([x, y]) => `x ${x * cellSize} to ${(x + 1) * cellSize - 1}, y ${y * cellSize} to ${(y + 1) * cellSize - 1}`;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = bounds.minX + Math.floor((e.clientX - rect.left) / layout.size);
    const y = bounds.minY + Math.floor((e.clientY - rect.top) / layout.size);
    const n = layout.lookup.get(`${x},${y}`);
    setHover(n ? { x, y, n, left: e.clientX - rect.left, top: e.clientY - rect.top } : null);
  };

  return (
    <ChartCard
      title="Where on the board"
      subtitle={`Changes by board position, whole history. Each square is ${cellSize}×${cellSize} board pixels; darker means more changes.`}
      empty={!bounds ? 'No changes with a known position yet.' : null}
      summary={`Heatmap of ${total} located changes. Busiest area: ${top[0] ? area(top[0]) : 'none'}`}
      table={{ head: ['Area (board pixels)', 'Changes'], rows: top.map((c) => [area(c), formatNumber(c[2])]) }}
      className="lg:col-span-2"
    >
      <div ref={wrap} className="overflow-x-auto rounded-xl bg-surface-2 p-3">
        {layout && (
          <div className="relative mx-auto w-fit" style={{ width: layout.cols * layout.size, height: layout.rows * layout.size }}>
            <canvas ref={canvas} style={{ width: layout.cols * layout.size, height: layout.rows * layout.size }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
            {hover && (
              <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop" style={{ left: hover.left, top: hover.top - 8 }}>
                <p className="font-medium">{formatNumber(hover.n)} {hover.n === 1 ? 'change' : 'changes'}</p>
                <p className="text-muted">{area([hover.x, hover.y])}</p>
              </div>
            )}
          </div>
        )}
      </div>
      <p className="mt-3 text-sm text-muted">
        Positions are the objects’ approximate centres when each change happened (rotation ignored).
        {heatmap.unlocated > 0 && ` ${formatNumber(heatmap.unlocated)} change${heatmap.unlocated === 1 ? '' : 's'} could not be placed and ${heatmap.unlocated === 1 ? 'is' : 'are'} not shown.`}
        {heatmap.hidden > 0 && ` The busiest ${formatNumber(cells.length)} squares are drawn; ${formatNumber(heatmap.hidden)} changes in quieter squares are left out.`}
      </p>
    </ChartCard>
  );
}
