import { cn, initials } from '../../utils/format.js';

// Color comes from the user record so a person looks the same everywhere (and, in Phase 3, as their cursor).
export function Avatar({ user, size = 28, ring = false, className }) {
  return (
    <span
      title={user?.name}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none', ring && 'ring-2 ring-surface', className)}
      style={{ width: size, height: size, background: user?.color || '#5B4BFF', fontSize: size * 0.4 }}
    >
      {initials(user?.name)}
    </span>
  );
}

export function AvatarStack({ users = [], total, size = 24, max = 3 }) {
  const shown = users.slice(0, max);
  const extra = (total ?? users.length) - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((u, i) => (
        <span key={u.id} className={i ? '-ml-1' : ''}>
          <Avatar user={u} size={size} ring />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="-ml-1 inline-flex items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted ring-2 ring-surface"
          style={{ width: size, height: size }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
