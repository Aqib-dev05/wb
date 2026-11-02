import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { loadIcons, loadLogos, logoPath, pinned, POPULAR_ICONS, POPULAR_LOGOS, SHAPES } from '../../canvas/library/catalog.js';
import { searchItems } from '../../canvas/library/search.js';
import { useUiStore } from '../../store/uiStore.js';
import { cn } from '../../utils/format.js';

const TABS = [['all', 'All'], ['shape', 'Shapes'], ['icon', 'Icons'], ['logo', 'Logos']];
const PAGE = 60;
const KIND_LABEL = { shape: 'shape', icon: 'icon', logo: 'logo' };

const luminance = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** On the board (always light paper) near-white brands would vanish, so they are drawn dark. */
const boardColor = (hex) => (luminance(hex) > 0.88 ? '#14161F' : `#${hex}`);
/** In the panel (either theme) the extremes use the text colour so they stay visible. */
const tileColor = (hex) => (luminance(hex) < 0.12 || luminance(hex) > 0.88 ? 'currentColor' : `#${hex}`);

const logoCache = new Map(); // slug -> path string, for tiles
function useLogoPath(slug) {
  const [d, setD] = useState(logoCache.get(slug) ?? null);
  useEffect(() => {
    let cancelled = false;
    if (logoCache.has(slug)) return undefined;
    logoPath(slug).then((p) => { logoCache.set(slug, p); if (!cancelled) setD(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);
  return d;
}

function Preview({ item }) {
  const logoD = useLogoPath(item.kind === 'logo' ? item.slug : null);
  if (item.kind === 'logo') {
    return logoD ? <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true"><path d={logoD} fill={tileColor(item.hex)} /></svg> : <span className="skeleton h-6 w-6 rounded" />;
  }
  if (item.kind === 'icon') {
    return <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.d} /></svg>;
  }
  const sw = Math.max(item.w, item.h) / 22;
  return (
    <svg viewBox={`${-sw} ${-sw} ${item.w + sw * 2} ${item.h + sw * 2}`} className="h-7 w-7" aria-hidden="true" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round"
      fill={item.fill === false ? 'none' : 'currentColor'} fillOpacity={item.fill === false ? 0 : 0.16} fillRule={item.evenodd ? 'evenodd' : 'nonzero'}>
      <path d={item.d} />
    </svg>
  );
}

function Tile({ item, onPick }) {
  return (
    <button type="button" onClick={() => onPick(item)} aria-label={`${item.name} (${KIND_LABEL[item.kind]})`} title={item.name} className="group flex h-[4.5rem] flex-col items-center justify-center gap-1 rounded-xl px-1 text-ink transition hover:bg-surface-2 focus-visible:bg-surface-2">
      <span className="flex h-8 items-center justify-center">
        <Preview item={item} />
      </span>
      <span className="w-full truncate text-center text-[11px] leading-tight text-muted group-hover:text-ink">{item.name}</span>
    </button>
  );
}

function Section({ title, children, note }) {
  return (
    <section className="px-2 pb-2">
      <h3 className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="grid grid-cols-4 gap-0.5">{children}</div>
      {note && <p className="px-2 pt-1 text-xs text-muted">{note}</p>}
    </section>
  );
}

/** Searchable library of shapes, icons (devices, networking, apps) and brand logos. Click an item to drop it on the board. */
export function LibraryPanel({ controller, onClose }) {
  const toast = useUiStore((s) => s.toast);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [tab, setTab] = useState('all');
  const [icons, setIcons] = useState({ status: 'loading', items: [] });
  const [logos, setLogos] = useState({ status: 'loading', items: [] });
  const [shown, setShown] = useState(PAGE);
  const [announce, setAnnounce] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    let live = true;
    loadIcons().then((items) => live && setIcons({ status: 'ready', items })).catch(() => live && setIcons({ status: 'error', items: [] }));
    loadLogos().then((items) => live && setLogos({ status: 'ready', items })).catch(() => live && setLogos({ status: 'error', items: [] }));
    return () => { live = false; };
  }, []);
  useEffect(() => setShown(PAGE), [deferred, tab]);

  const pick = async (item) => {
    try {
      const d = item.kind === 'logo' ? await logoPath(item.slug) : item.d;
      const result = controller?.insertLibraryItem({ kind: item.kind, d, w: item.w, h: item.h, fill: item.fill, evenodd: item.evenodd, color: item.hex && boardColor(item.hex) });
      if (result?.ok) setAnnounce(`Added ${item.name} to the board`);
      else toast(result?.reason ?? 'Could not add that item', 'error');
    } catch {
      toast(`Could not load the ${item.name} logo. Check your connection and try again.`, 'error');
    }
  };

  const searching = deferred.trim().length > 0;
  const pool = useMemo(() => {
    const all = { shape: SHAPES, icon: icons.items, logo: logos.items };
    return (tab === 'all' ? [...SHAPES, ...icons.items, ...logos.items] : all[tab]);
  }, [tab, icons.items, logos.items]);
  const results = useMemo(() => (searching || tab !== 'all' ? searchItems(pool, deferred, { limit: 600 }) : []), [pool, deferred, searching, tab]);
  const loading = (tab !== 'shape' && icons.status === 'loading') || (tab !== 'shape' && tab !== 'icon' && logos.status === 'loading');
  const failed = (tab === 'icon' && icons.status === 'error') || (tab === 'logo' && logos.status === 'error');

  return (
    <aside aria-label="Shapes, icons and logos" className="pointer-events-auto absolute inset-x-3 bottom-16 z-20 flex max-h-[62vh] flex-col overflow-hidden rounded-2xl bg-surface shadow-pop sm:inset-x-auto sm:bottom-20 sm:left-[4.75rem] sm:top-20 sm:max-h-none sm:w-80"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="flex items-center gap-2 border-b border-line p-3">
        <label className="relative flex-1">
          <span className="sr-only">Search shapes, icons and logos</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input ref={inputRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search laptop, react, fb…" autoComplete="off" spellCheck="false"
            className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25" />
        </label>
        <button type="button" aria-label="Close library" title="Close" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"><X size={18} /></button>
      </div>
      <div role="tablist" aria-label="Library category" className="flex gap-1 border-b border-line px-3 py-2">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('rounded-md px-2.5 py-1 text-sm font-medium transition', tab === id ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink')}>{label}</button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {!searching && tab === 'all' ? (
          <>
            <Section title="Shapes">{SHAPES.map((i) => <Tile key={i.id} item={i} onPick={pick} />)}</Section>
            <Section title="Icons" note={icons.status === 'error' ? 'Icons could not be loaded.' : 'Popular. Search to find more than 2,000 icons.'}>
              {icons.status === 'loading' ? <Loading /> : pinned(icons.items, POPULAR_ICONS).map((i) => <Tile key={i.id} item={i} onPick={pick} />)}
            </Section>
            <Section title="Logos" note={logos.status === 'error' ? 'Logos could not be loaded.' : 'Popular. Search to find more than 3,000 brands.'}>
              {logos.status === 'loading' ? <Loading /> : pinned(logos.items, POPULAR_LOGOS).map((i) => <Tile key={i.id} item={i} onPick={pick} />)}
            </Section>
          </>
        ) : (
          <div className="px-2 pt-2">
            {failed && <p role="alert" className="px-2 py-6 text-center text-sm text-danger">Couldn’t load this part of the library. Check your connection and reopen it.</p>}
            {loading && !results.length && <Loading />}
            {!failed && !loading && !results.length && (
              <p className="px-2 py-8 text-center text-sm text-muted">Nothing matches “{deferred.trim()}”. Try another word, e.g. “server”, “database” or a product name.</p>
            )}
            <div className="grid grid-cols-4 gap-0.5">{results.slice(0, shown).map((i) => <Tile key={i.id} item={i} onPick={pick} />)}</div>
            {loading && results.length > 0 && <p className="px-2 py-2 text-center text-xs text-muted">Still loading more…</p>}
            {results.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-2 w-full rounded-lg py-2 text-sm font-medium text-primary hover:bg-surface-2">Show more ({results.length - shown} left)</button>
            )}
          </div>
        )}
        <p className="px-4 pb-1 pt-3 text-[11px] leading-snug text-muted">Icons: Lucide. Logos: Simple Icons. Brand logos are trademarks of their owners.</p>
      </div>
      <p role="status" className="sr-only">{announce}</p>
    </aside>
  );
}

function Loading() {
  return <div className="col-span-4 flex items-center justify-center gap-2 py-6 text-sm text-muted" role="status"><Loader2 size={15} className="animate-spin" /> Loading…</div>;
}
