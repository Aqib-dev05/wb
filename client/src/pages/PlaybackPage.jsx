import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { History } from 'lucide-react';
import { BottomBar } from '../components/editor/BottomBar.jsx';
import { CanvasStage } from '../components/editor/CanvasStage.jsx';
import { PlayerBar } from '../components/playback/PlayerBar.jsx';
import { ReplayTopBar } from '../components/playback/ReplayTopBar.jsx';
import { SessionList } from '../components/playback/SessionList.jsx';
import { Button } from '../components/ui/Button.jsx';
import { useCanvas } from '../hooks/useCanvas.js';
import { usePlayback } from '../hooks/usePlayback.js';
import { boardService } from '../services/board.service.js';
import { playbackService } from '../services/playback.service.js';
import { useEditorStore } from '../store/editorStore.js';

const PAGE_SIZE = 20;
const SKIP_MS = 5000;

function Unavailable({ title, message, to = '/' , action = 'Back to boards' }) {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted">{message}</p>
      <Link to={to}><Button variant="secondary" className="mt-4">{action}</Button></Link>
    </div>
  );
}

function Replay({ board, sessionId }) {
  const navigate = useNavigate();
  const hostRef = useRef(null);
  const panelOpen = useEditorStore((s) => s.panelOpen);
  const controller = useCanvas(hostRef, true); // history is never editable

  const [list, setList] = useState({ status: 'loading', items: [], meta: null, error: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [detail, setDetail] = useState({ status: 'idle', session: null, error: null });

  useEffect(() => {
    let cancelled = false;
    playbackService.sessions(board.id, { page: 1, limit: PAGE_SIZE })
      .then(({ data, meta }) => !cancelled && setList({ status: 'ready', items: data.sessions, meta, error: null }))
      .catch((err) => !cancelled && setList({ status: 'error', items: [], meta: null, error: err.message }));
    return () => { cancelled = true; };
  }, [board.id]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { data, meta } = await playbackService.sessions(board.id, { page: (list.meta?.page ?? 1) + 1, limit: PAGE_SIZE });
      setList((l) => ({ ...l, items: [...l.items, ...data.sessions.filter((s) => !l.items.some((x) => x.id === s.id))], meta }));
    } catch (err) {
      setList((l) => ({ ...l, error: err.message }));
    } finally {
      setLoadingMore(false);
    }
  };

  // The URL names the session; without one we show the most recent that has something to watch
  // (opening the editor starts an empty live session, which would otherwise hide the real recording).
  const defaultSession = list.status === 'ready' ? (list.items.find((s) => s.eventCount > 0) ?? list.items[0]) : null;
  const selectedId = sessionId ?? defaultSession?.id ?? null;

  useEffect(() => {
    if (!selectedId) {
      setDetail({ status: 'idle', session: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setDetail({ status: 'loading', session: null, error: null });
    playbackService.session(board.id, selectedId)
      .then((session) => !cancelled && setDetail({ status: 'ready', session, error: null }))
      .catch((err) => !cancelled && setDetail({ status: 'error', session: null, error: err.message }));
    return () => { cancelled = true; };
  }, [board.id, selectedId]);

  useEffect(() => {
    controller?.setInsets({ right: panelOpen ? 288 : 40, bottom: 190 }); // clear the player bar
  }, [controller, panelOpen]);

  const { engine, snap } = usePlayback(controller, board.id, detail.session);

  // Space play/pause, arrows ±5s, Home restart.
  useEffect(() => {
    if (!engine) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable) return;
      if (e.key === ' ') {
        if (tag === 'BUTTON') return; // the focused button handles Space itself
        e.preventDefault();
        engine.toggle();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        engine.seek(engine.time - SKIP_MS);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        engine.seek(engine.time + SKIP_MS);
      } else if (e.key === 'Home') {
        e.preventDefault();
        engine.seek(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  const select = (id) => navigate(`/board/${board.id}/replay/${id}`);
  const session = detail.session;
  const nothingRecorded = list.status === 'ready' && list.items.length === 0;
  const busy = list.status === 'loading' || detail.status === 'loading' || (snap?.loading && !snap?.time);

  return (
    <div className="relative h-full overflow-hidden">
      <CanvasStage hostRef={hostRef} controller={controller} />

      {busy && !nothingRecorded && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center bg-canvas/70" role="status" aria-label="Loading recording">
          <div className="skeleton h-5 w-40 rounded" />
        </div>
      )}
      {nothingRecorded && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center px-6 text-center">
          <History size={32} className="mb-3 text-muted" />
          <h2 className="font-display text-lg font-semibold">No recorded sessions yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted">Every time people work on this board, their changes are recorded. Make a change on the board, then come back here to watch it back.</p>
          <Link to={`/board/${board.id}`}><Button className="mt-4">Open the board</Button></Link>
        </div>
      )}
      {detail.status === 'error' && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center bg-canvas/80 px-6 text-center" role="alert">
          <h2 className="font-display text-lg font-semibold">We couldn’t open that session</h2>
          <p className="mt-1 text-sm text-muted">{detail.error}</p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0">
        <ReplayTopBar board={board} session={session} />
        <SessionList list={list} selectedId={selectedId} onSelect={select} onMore={loadMore} loadingMore={loadingMore} />
        {session && snap && (
          <PlayerBar
            snap={snap}
            session={session}
            rightInset={panelOpen ? 288 : 12}
            onToggle={() => engine.toggle()}
            onSeek={(ms) => engine.seek(ms)}
            onSpeed={(s) => engine.setSpeed(s)}
          />
        )}
        <BottomBar controller={controller} readOnly />
      </div>
    </div>
  );
}

export default function PlaybackPage() {
  const { id, sessionId } = useParams();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    boardService.get(id)
      .then((board) => !cancelled && setState({ status: 'ready', board }))
      .catch((err) => !cancelled && setState({ status: 'error', error: err.message }));
    return () => { cancelled = true; };
  }, [id]);

  if (state.status === 'loading') return <div className="flex h-full items-center justify-center"><div className="skeleton h-5 w-40 rounded" role="status" aria-label="Loading board" /></div>;
  if (state.status === 'error') return <Unavailable title="We couldn’t open this board" message={state.error} />;
  return <Replay key={id} board={state.board} sessionId={sessionId} />;
}
