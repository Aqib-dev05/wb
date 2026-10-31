import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { useUiStore } from '../../store/uiStore.js';

const icons = { success: CheckCircle2, error: CircleAlert, info: Info };
const tint = { success: 'text-mint', error: 'text-danger', info: 'text-primary' };

export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => {
        const Icon = icons[t.type] || Info;
        return (
          <div key={t.id} className="anim-pop pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl bg-surface py-2.5 pl-3 pr-2 text-sm shadow-pop">
            <Icon size={18} className={tint[t.type]} />
            <span>{t.message}</span>
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded p-1 text-muted hover:bg-surface-2">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
