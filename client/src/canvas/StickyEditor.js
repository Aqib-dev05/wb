import { util } from 'fabric';
import { FONT } from './constants.js';
import { STICKY_PAD } from './Sticky.js';

/**
 * Imperative overlay <textarea> positioned exactly over a sticky note while it is edited.
 * Lives with the canvas code (not React) because it must track zoom/pan/rotation precisely.
 */
export class StickyEditor {
  constructor(host, canvas, onClose) {
    this.host = host;
    this.canvas = canvas;
    this.onClose = onClose;
    this.sticky = null;
    this.area = null;
  }

  get isOpen() {
    return Boolean(this.sticky);
  }

  open(sticky) {
    if (this.sticky) this.close();
    this.sticky = sticky;
    sticky.isEditing = true;
    this.canvas.requestRenderAll();

    const area = document.createElement('textarea');
    area.value = sticky.text || '';
    area.setAttribute('aria-label', 'Sticky note text');
    area.spellcheck = false;
    Object.assign(area.style, {
      position: 'absolute',
      zIndex: '5',
      boxSizing: 'border-box',
      resize: 'none',
      overflow: 'hidden',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      margin: '0',
      transformOrigin: 'center center',
      fontFamily: FONT,
      lineHeight: '1.3',
      color: sticky.textColor,
    });
    area.addEventListener('input', () => this.#onInput());
    area.addEventListener('blur', () => this.close());
    area.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep editor shortcuts (delete, undo...) out of the text field
      if (e.key === 'Escape') this.close();
    });
    this.host.appendChild(area);
    this.area = area;
    this.#place();
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  #place() {
    const { sticky, area, canvas } = this;
    const zoom = canvas.getZoom();
    const m = util.multiplyTransformMatrices(canvas.viewportTransform, sticky.calcTransformMatrix());
    const w = sticky.width * sticky.scaleX * zoom;
    const h = sticky.height * sticky.scaleY * zoom;
    Object.assign(area.style, {
      left: `${m[4] - w / 2}px`,
      top: `${m[5] - h / 2}px`,
      width: `${w}px`,
      height: `${h}px`,
      padding: `${STICKY_PAD * zoom}px`,
      fontSize: `${sticky.fontSize * zoom}px`,
      transform: `rotate(${sticky.angle}deg)`,
    });
  }

  #onInput() {
    const { sticky, area, canvas } = this;
    sticky.set('text', area.value);
    const needed = sticky.requiredHeight(canvas.getContext());
    if (needed > sticky.height) sticky.set('height', needed); // grow to fit, never shrink while typing
    sticky.setCoords();
    this.#place();
    canvas.requestRenderAll();
  }

  close() {
    const { sticky, area } = this;
    if (!sticky) return;
    this.sticky = null;
    this.area = null;
    sticky.isEditing = false;
    sticky.dirty = true;
    area.remove();
    this.canvas.requestRenderAll();
    this.onClose(sticky);
  }
}
