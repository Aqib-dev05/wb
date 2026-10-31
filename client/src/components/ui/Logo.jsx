export function LogoMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <rect x="7" y="7" width="12" height="12" rx="2" fill="#FFD84D" />
      <path d="M17 17l8 3-3.4 1.6L20 25z" fill="#fff" />
    </svg>
  );
}

export function Logo({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-lg font-semibold tracking-tight ${className}`}>
      <LogoMark />
      CollabBoard
    </span>
  );
}
