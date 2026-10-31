import { CircleAlert, Plus, SearchX } from 'lucide-react';
import { Button } from '../ui/Button.jsx';

export function BoardSkeletons({ view }) {
  const items = Array.from({ length: view === 'grid' ? 8 : 5 });
  return view === 'grid' ? (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
      {items.map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="skeleton aspect-[16/10]" />
          <div className="space-y-2 p-4"><div className="skeleton h-4 w-2/3 rounded" /><div className="skeleton h-3 w-1/2 rounded" /></div>
        </div>
      ))}
    </div>
  ) : (
    <div className="space-y-2" aria-hidden="true">{items.map((_, i) => <div key={i} className="skeleton h-[74px] rounded-xl" />)}</div>
  );
}

export function EmptyBoards({ onCreate }) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-line px-6 py-16 text-center">
      <div className="relative mb-6 h-24 w-32" aria-hidden="true">
        <span className="absolute left-2 top-4 h-14 w-14 -rotate-6 rounded-md bg-sticky shadow-card" />
        <span className="absolute left-12 top-8 h-14 w-14 rotate-3 rounded-md bg-[#b9f0d8] shadow-card" />
        <span className="absolute left-20 top-2 h-12 w-12 rotate-12 rounded-md bg-[#c9c2ff] shadow-card" />
      </div>
      <h2 className="font-display text-xl font-semibold tracking-tight">Start your first board</h2>
      <p className="mt-2 max-w-sm text-sm text-muted">A board is a shared canvas. Sketch ideas, add sticky notes, and invite teammates to work on it live.</p>
      <Button icon={Plus} onClick={onCreate} className="mt-6">New board</Button>
    </div>
  );
}

export function NoResults({ query, onClear }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <SearchX size={32} className="mb-3 text-muted" />
      <h2 className="font-medium">No boards match “{query}”</h2>
      <p className="mt-1 text-sm text-muted">Check the spelling or try a shorter name.</p>
      <Button variant="secondary" size="sm" onClick={onClear} className="mt-4">Clear search</Button>
    </div>
  );
}

export function LoadError({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center py-16 text-center">
      <CircleAlert size={32} className="mb-3 text-danger" />
      <h2 className="font-medium">Couldn’t load your boards</h2>
      <p className="mt-1 text-sm text-muted">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry} className="mt-4">Try again</Button>
    </div>
  );
}
