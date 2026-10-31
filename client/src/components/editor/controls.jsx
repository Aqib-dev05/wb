import { useEffect, useRef } from 'react';
import { cn } from '../../utils/format.js';

export function Section({ title, children }) {
  return (
    <div className="border-t border-line px-4 py-3.5 first:border-t-0">
      <h3 className="mb-2.5 text-xs font-medium text-muted">{title}</h3>
      {children}
    </div>
  );
}

const CHECKER = 'repeating-conic-gradient(#d9dbe6 0% 25%, #fff 0% 50%) 50% / 8px 8px';

/** Swatch row + custom color. `onLive` runs while dragging in the picker, `onCommit` when a value is final. */
export function ColorField({ value, palette, allowTransparent, onLive, onCommit, label }) {
  const input = useRef(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const el = input.current;
    const handler = () => commit.current();
    el?.addEventListener('change', handler);
    return () => el?.removeEventListener('change', handler);
  }, []);

  const colors = allowTransparent ? ['transparent', ...palette] : palette;
  const pick = (c) => {
    onLive(c);
    onCommit();
  };
  const isCustom = value && !colors.some((c) => c.toLowerCase() === value.toLowerCase());
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#5b4bff';

  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c === 'transparent' ? `${label}: none` : `${label}: ${c}`}
          aria-pressed={value?.toLowerCase() === c.toLowerCase()}
          onClick={() => pick(c)}
          className={cn('h-6 w-6 rounded-full border border-line transition hover:scale-110', value?.toLowerCase() === c.toLowerCase() && 'ring-2 ring-primary ring-offset-2 ring-offset-surface')}
          style={{ background: c === 'transparent' ? CHECKER : c }}
        />
      ))}
      <label
        className={cn('relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-line transition hover:scale-110', isCustom && 'ring-2 ring-primary ring-offset-2 ring-offset-surface')}
        style={{ background: isCustom ? value : 'conic-gradient(#ff6b57, #ffd84d, #2fcb8e, #2e9bff, #8a5cf6, #ff6b57)' }}
        title="Custom color"
      >
        <input ref={input} type="color" value={hex} onChange={(e) => onLive(e.target.value)} aria-label={`${label}: custom color`} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

export function Slider({ label, value, min, max, step = 1, suffix = '', onLive, onCommit }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="h-1.5 flex-1 cursor-pointer accent-[var(--primary)]"
      />
      <span className="w-12 text-right text-sm tabular-nums text-ink">{Math.round(value * (suffix === '%' ? 100 : 1))}{suffix}</span>
    </div>
  );
}
