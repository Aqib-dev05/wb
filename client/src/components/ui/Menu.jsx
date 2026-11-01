import { cloneElement, useEffect, useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useCommon.js';
import { cn } from '../../utils/format.js';

/**
 * Small popover menu. `items`: [{ label, icon, onSelect, danger, hidden }]
 * Keyboard (WAI-ARIA menu button): Enter/Space/ArrowDown on the trigger opens it and focuses the
 * first item; Arrow keys, Home and End move between items; Escape closes and returns focus to the
 * trigger; Tab closes and carries on from the trigger.
 */
export function Menu({ trigger, items, align = 'right', className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), open);
  const visible = items.filter((i) => !i.hidden);

  const triggerButton = () => ref.current?.querySelector('[data-menu-trigger] button');
  const menuItems = () => [...(ref.current?.querySelectorAll('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (open) menuItems()[0]?.focus();
  }, [open]);

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' && e.target === triggerButton()) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    const list = menuItems();
    const at = list.indexOf(document.activeElement);
    const move = (i) => { e.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(-1);
    else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      triggerButton()?.focus();
    } else if (e.key === 'Tab') {
      triggerButton()?.focus(); // the default Tab then moves on from the trigger, not from a removed item
      setOpen(false);
    }
  };

  const node = trigger({ open });
  return (
    <div ref={ref} className={cn('relative', className)} onKeyDown={onKeyDown}>
      <span data-menu-trigger onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {cloneElement(node, { 'aria-haspopup': 'menu', 'aria-expanded': open })}
      </span>
      {open && (
        <div role="menu" className={cn('anim-pop absolute z-30 mt-1 min-w-44 rounded-xl bg-surface p-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}>
          {visible.map(({ label, icon: Icon, onSelect, danger }) => (
            <button
              key={label}
              role="menuitem"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); setOpen(false); triggerButton()?.focus(); onSelect(); }}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-surface-2 focus-visible:bg-surface-2', danger ? 'text-danger' : 'text-ink')}
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
