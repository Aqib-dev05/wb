const PALETTES = [
  ['#FFD84D', '#B9F0D8', '#FFD0C9'],
  ['#C9C2FF', '#FFD84D', '#B9E3FF'],
  ['#B9F0D8', '#FFD0C9', '#C9C2FF'],
];

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Real thumbnail once the editor saves one (Phase 2). Until then, an abstract placeholder
 * derived from the board id — clearly decorative, not a rendering of board content.
 */
export function BoardThumbnail({ board, className = '' }) {
  if (board.thumbnail) {
    return <img src={board.thumbnail} alt="" loading="lazy" className={`h-full w-full object-cover ${className}`} />;
  }
  const h = hash(board.id);
  const colors = PALETTES[h % PALETTES.length];
  const tilt = (n) => ((h >> n) % 7) - 3;
  return (
    <div className={`dot-grid relative h-full w-full overflow-hidden bg-surface-2 ${className}`} aria-hidden="true">
      {colors.map((c, i) => (
        <span
          key={i}
          className="absolute rounded-sm opacity-90 shadow-sm"
          style={{
            background: c,
            width: '22%',
            height: '30%',
            left: `${14 + i * 26 + ((h >> (i + 2)) % 6)}%`,
            top: `${18 + ((i * 23 + (h >> i)) % 38)}%`,
            transform: `rotate(${tilt(i + 1)}deg)`,
          }}
        />
      ))}
    </div>
  );
}
