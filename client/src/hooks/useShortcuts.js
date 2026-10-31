import { useEffect } from 'react';

const TOOL_KEYS = { v: 'select', h: 'hand', p: 'pen', r: 'rect', o: 'ellipse', g: 'triangle', l: 'line', a: 'arrow', t: 'text', n: 'sticky' };
const isTyping = (t) => t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);

export function useShortcuts(controller, readOnly) {
  useEffect(() => {
    if (!controller) return undefined;

    const onKeyDown = (e) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (e.code === 'Space') {
        e.preventDefault();
        controller.setPanOverride(true);
        return;
      }
      if (key === '=' || key === '+') return void (e.preventDefault(), controller.zoomBy(1.25));
      if (key === '-') return void (e.preventDefault(), controller.zoomBy(0.8));
      if (!mod && key === '0') return void controller.resetZoom();
      if (e.shiftKey && e.code === 'Digit1') return void controller.zoomToFit();
      if (key === 'escape') {
        controller.clearSelection();
        return void controller.setTool('select');
      }
      if (mod && key === 'a') return void (e.preventDefault(), controller.selectAll());
      if (mod && key === 'c') return void controller.copy();
      if (readOnly) {
        if (!mod && (key === 'v' || key === 'h')) controller.setTool(TOOL_KEYS[key]);
        return;
      }

      if (mod && key === 'z') return void (e.preventDefault(), e.shiftKey ? controller.redo() : controller.undo());
      if (mod && key === 'y') return void (e.preventDefault(), controller.redo());
      if (mod && key === 'x') return void controller.cut();
      if (mod && key === 'v') return void controller.paste();
      if (mod && key === 'd') return void (e.preventDefault(), controller.duplicate());
      if (key === 'delete' || key === 'backspace') return void (e.preventDefault(), controller.deleteSelection());
      if (key === '[') return void controller.reorder('back');
      if (key === ']') return void controller.reorder('front');
      if (key.startsWith('arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        controller.nudge(key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0);
        return;
      }
      if (!mod && !e.altKey && TOOL_KEYS[key]) controller.setTool(TOOL_KEYS[key]);
    };

    const onKeyUp = (e) => e.code === 'Space' && controller.setPanOverride(false);
    const onBlur = () => controller.setPanOverride(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [controller, readOnly]);
}
