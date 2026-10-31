import { useEffect, useState } from 'react';
import { CanvasController } from '../canvas/CanvasController.js';
import { useEditorStore } from '../store/editorStore.js';

/** Creates the CanvasController for `hostRef` and mirrors its events into the editor store. */
export function useCanvas(hostRef, readOnly) {
  const [controller, setController] = useState(null);

  useEffect(() => {
    const store = useEditorStore.getState();
    store.reset();
    const c = new CanvasController(hostRef.current, { readOnly });
    const offs = [
      c.on('tool', store.setTool),
      c.on('selection', store.setSelection),
      c.on('defaults', store.setDefaults),
      c.on('history', store.setHistory),
      c.on('viewport', store.setViewport),
    ];
    if (import.meta.env.DEV) window.__controller = c; // handle for browser tests; absent in production builds
    setController(c);
    return () => {
      offs.forEach((off) => off());
      c.dispose();
      setController(null);
    };
    // The controller is created once per mount; readOnly changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controller?.setReadOnly(readOnly);
  }, [controller, readOnly]);

  return controller;
}
