import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Pencil } from 'lucide-react';
import { useDismiss } from '../../hooks/useCommon.js';
import { useAuthStore } from '../../store/authStore.js';
import { useUiStore } from '../../store/uiStore.js';
import { Avatar } from '../ui/Avatar.jsx';
import { Logo } from '../ui/Logo.jsx';
import { PromptDialog } from '../ui/Modal.jsx';
import { ThemeToggle } from '../ui/ThemeToggle.jsx';

export function AppHeader() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const updateName = useAuthStore((s) => s.updateName);
  const toast = useUiStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false), open);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="CollabBoard home"><Logo /></Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <div ref={ref} className="relative">
            <button onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open} className="ml-1 rounded-full">
              <Avatar user={user} size={32} />
            </button>
            {open && (
              <div className="anim-pop absolute right-0 mt-2 w-64 rounded-xl bg-surface p-1.5 shadow-pop">
                <div className="flex items-center gap-3 px-3 py-3">
                  <Avatar user={user} size={36} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{user?.name}</p>
                    <p className="truncate text-xs text-muted">{user?.email}</p>
                  </div>
                </div>
                <div className="my-1 h-px bg-line" />
                <button onClick={() => { setOpen(false); setEditing(true); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
                  <Pencil size={16} /> Edit display name
                </button>
                <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-danger hover:bg-surface-2">
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {editing && (
        <PromptDialog
          title="Display name"
          label="Name shown to collaborators"
          initial={user?.name}
          confirmLabel="Save name"
          onClose={() => setEditing(false)}
          onSubmit={async (name) => {
            await updateName(name);
            toast('Name updated', 'success');
          }}
        />
      )}
    </header>
  );
}
