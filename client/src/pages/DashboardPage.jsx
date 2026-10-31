import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, List, Plus, Search } from 'lucide-react';
import { BoardCard, BoardRow } from '../components/dashboard/BoardItem.jsx';
import { BoardSkeletons, EmptyBoards, LoadError, NoResults } from '../components/dashboard/States.jsx';
import { AppHeader } from '../components/layout/AppHeader.jsx';
import { Button, IconButton } from '../components/ui/Button.jsx';
import { ConfirmDialog, PromptDialog } from '../components/ui/Modal.jsx';
import { useDebouncedValue } from '../hooks/useCommon.js';
import { useAuthStore } from '../store/authStore.js';
import { useBoardStore } from '../store/boardStore.js';
import { useUiStore } from '../store/uiStore.js';
import { cn } from '../utils/format.js';

const SCOPES = [
  { id: 'all', label: 'All boards' },
  { id: 'recent', label: 'Recently opened' },
  { id: 'owned', label: 'Owned by me' },
  { id: 'shared', label: 'Shared with me' },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const firstName = useAuthStore((s) => s.user?.name.split(' ')[0]);
  const { boards, meta, status, error, query, scope, setQuery, setScope, load, loadMore, create, rename, remove } = useBoardStore();
  const { boardView, setBoardView, toast } = useUiStore();
  const [dialog, setDialog] = useState(null); // { type: 'create' | 'rename' | 'delete', board? }
  const [loadingMore, setLoadingMore] = useState(false);

  const debouncedQuery = useDebouncedValue(query);
  useEffect(() => { load(); }, [debouncedQuery, scope, load]);

  const closeDialog = () => setDialog(null);
  const handlers = {
    onRename: (board) => setDialog({ type: 'rename', board }),
    onDelete: (board) => setDialog({ type: 'delete', board }),
  };
  const Item = boardView === 'grid' ? BoardCard : BoardRow;
  const hasFilters = Boolean(debouncedQuery) || scope !== 'all';

  const onLoadMore = async () => {
    setLoadingMore(true);
    try { await loadMore(); } catch (err) { toast(err.message, 'error'); } finally { setLoadingMore(false); }
  };

  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Hi, {firstName}</h1>
            <p className="mt-1 text-sm text-muted">{meta.total > 0 || hasFilters ? `${meta.total} ${meta.total === 1 ? 'board' : 'boards'}${hasFilters ? ' match' : ''}` : 'Your boards will show up here.'}</p>
          </div>
          <Button icon={Plus} size="lg" onClick={() => setDialog({ type: 'create' })}>New board</Button>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1 sm:max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search boards"
              aria-label="Search boards"
              className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Board filter">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={scope === s.id}
                onClick={() => setScope(s.id)}
                className={cn('rounded-md px-3 py-1.5 text-sm transition', scope === s.id ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink')}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-1">
            <IconButton label="Grid view" icon={LayoutGrid} active={boardView === 'grid'} onClick={() => setBoardView('grid')} />
            <IconButton label="List view" icon={List} active={boardView === 'list'} onClick={() => setBoardView('list')} />
          </div>
        </div>

        <section className="mt-6" aria-busy={status === 'loading'}>
          {status === 'loading' && boards.length === 0 && <BoardSkeletons view={boardView} />}
          {status === 'error' && <LoadError message={error} onRetry={load} />}
          {status === 'ready' && boards.length === 0 && (debouncedQuery ? <NoResults query={debouncedQuery} onClear={() => setQuery('')} /> : hasFilters ? <p className="py-16 text-center text-sm text-muted">Nothing in this view yet.</p> : <EmptyBoards onCreate={() => setDialog({ type: 'create' })} />)}
          {boards.length > 0 && (
            <div className={cn(boardView === 'grid' ? 'grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'space-y-2', status === 'loading' && 'opacity-60 transition-opacity')}>
              {boards.map((b) => <Item key={b.id} board={b} {...handlers} />)}
            </div>
          )}
          {meta.page < meta.totalPages && (
            <div className="mt-8 flex justify-center"><Button variant="secondary" loading={loadingMore} onClick={onLoadMore}>Show more</Button></div>
          )}
        </section>
      </main>

      {dialog?.type === 'create' && (
        <PromptDialog
          title="New board"
          label="Board name"
          initial="Untitled board"
          confirmLabel="Create board"
          onClose={closeDialog}
          onSubmit={async (title) => { const b = await create(title); navigate(`/board/${b.id}`); }}
        />
      )}
      {dialog?.type === 'rename' && (
        <PromptDialog
          title="Rename board"
          label="Board name"
          initial={dialog.board.title}
          confirmLabel="Save name"
          onClose={closeDialog}
          onSubmit={async (title) => { await rename(dialog.board.id, title); toast('Board renamed', 'success'); }}
        />
      )}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title="Delete board?"
          message={`“${dialog.board.title}” and its history will be permanently deleted for everyone. This can’t be undone.`}
          confirmLabel="Delete board"
          onClose={closeDialog}
          onConfirm={async () => {
            try { await remove(dialog.board.id); toast('Board deleted', 'success'); } catch (err) { toast(err.message, 'error'); throw err; }
          }}
        />
      )}
    </div>
  );
}
