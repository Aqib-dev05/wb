import { useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useCommon.js';
import { cn } from '../../utils/format.js';

/** Small popover menu. `items`: [{ label, icon, onSelect, danger, hidden }] */
export function Menu({ trigger, items, align = 'right', className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), open);
  const visible = items.filter((i) => !i.hidden);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <span onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>{trigger({ open })}</span>
      {open && (
        <div role="menu" className={cn('anim-pop absolute z-30 mt-1 min-w-44 rounded-xl bg-surface p-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}>
          {visible.map(({ label, icon: Icon, onSelect, danger }) => (
            <button
              key={label}
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onSelect(); }}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-surface-2', danger ? 'text-danger' : 'text-ink')}
            >
              {Icon && <Icon size={16} />}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
