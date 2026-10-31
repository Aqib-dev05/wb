import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BottomBar } from '../components/editor/BottomBar.jsx';
import { CanvasStage } from '../components/editor/CanvasStage.jsx';
import { PropertiesPanel } from '../components/editor/PropertiesPanel.jsx';
import { ToolPalette } from '../components/editor/ToolPalette.jsx';
import { TopBar } from '../components/editor/TopBar.jsx';
import { Button } from '../components/ui/Button.jsx';
import { RemoteCursors } from '../components/editor/RemoteCursors.jsx';
import { ShareDialog } from '../components/editor/ShareDialog.jsx';
import { useCollaboration } from '../hooks/useCollaboration.js';
import { useCanvas } from '../hooks/useCanvas.js';
import { useShortcuts } from '../hooks/useShortcuts.js';
import { boardService } from '../services/board.service.js';
import { useEditorStore } from '../store/editorStore.js';
import { useUiStore } from '../store/uiStore.js';

function BoardUnavailable({ message }) {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-xl font-semibold">We couldn’t open this board</h1>
      <p className="mt-1 text-sm text-muted">{message}</p>
      <Link to="/"><Button variant="secondary" className="mt-4">Back to boards</Button></Link>
    </div>
  );
}

/** Mounted once the board record is loaded. Canvas content arrives over the socket (board:join). */
function Editor({ initialBoard }) {
  const toast = useUiStore((s) => s.toast);
  const [board, setBoard] = useState(initialBoard);
  const [sharing, setSharing] = useState(false);
  const hostRef = useRef(null);
  const readOnly = board.role === 'viewer';
  const panelOpen = useEditorStore((s) => s.panelOpen);

  const controller = useCanvas(hostRef, readOnly);
  useShortcuts(controller, readOnly);
  const { session, loaded, failure } = useCollaboration(controller, board.id, {
    onRole: (role) => {
      setBoard((b) => (b.role === role || b.role === 'owner' ? b : { ...b, role }));
      if (role !== board.role && board.role !== 'owner') toast(role === 'viewer' ? 'You now have view-only access' : 'You can now edit this board', 'info');
    },
  });

  useEffect(() => {
    controller?.setInsets({ right: panelOpen ? 288 : 40 });
  }, [controller, panelOpen]);

  const rename = useCallback(async (title) => {
    try {
      setBoard(await boardService.rename(board.id, title));
    } catch (err) {
      toast(err.message, 'error');
    }
  }, [board.id, toast]);

  if (failure) return <BoardUnavailable message={failure.message} />;

  return (
    <div className="relative h-full overflow-hidden">
      <CanvasStage hostRef={hostRef} controller={controller} />
      <RemoteCursors controller={controller} session={session} />
      {!loaded && <div className="absolute inset-0 z-30 flex items-center justify-center bg-canvas/70" role="status" aria-label="Loading board"><div className="skeleton h-5 w-40 rounded" /></div>}
      <div className="pointer-events-none absolute inset-0">
        <TopBar board={board} readOnly={readOnly} onRename={rename} onShare={() => setSharing(true)} />
        <ToolPalette controller={controller} readOnly={readOnly} />
        <PropertiesPanel controller={controller} board={board} readOnly={readOnly} />
        <BottomBar controller={controller} readOnly={readOnly} />
      </div>
      {sharing && <ShareDialog board={board} isOwner={board.role === 'owner'} onClose={() => setSharing(false)} />}
    </div>
  );
}

export default function EditorPage() {
  const { id } = useParams();
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
  if (state.status === 'error') return <BoardUnavailable message={state.error} />;
  return <Editor key={id} initialBoard={state.board} />;
}
