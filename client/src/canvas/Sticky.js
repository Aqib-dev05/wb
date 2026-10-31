import { Rect, Shadow, classRegistry } from 'fabric';
import { FONT } from './constants.js';

export const STICKY_PAD = 14;
const LINE_HEIGHT = 1.3;

/** Greedy word wrap that also splits words longer than the line. */
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = line + word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
        while (ctx.measureText(line).width > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut -= 1;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/**
 * A sticky note is one Fabric object (a rounded rect that paints its own text), not a group:
 * it serializes as flat JSON, syncs as a single object in Phase 3, and resizes like a rect.
 * Text is edited through an overlay <textarea> (see StickyEditor), while `isEditing` hides
 * the painted text so the two never double up.
 */
export class Sticky extends Rect {
  static type = 'Sticky';
  static customProperties = ['id', 'kind', 'text', 'fontSize', 'textColor'];

  constructor(options = {}) {
    super({
      width: 200,
      height: 200,
      rx: 6,
      ry: 6,
      strokeWidth: 0,
      text: '',
      fontSize: 20,
      textColor: '#2B2300',
      kind: 'sticky',
      shadow: new Shadow({ color: 'rgba(20,22,31,0.18)', blur: 14, offsetX: 0, offsetY: 5 }),
      ...options,
    });
    this.isEditing = false;
  }

  /** Lines of text as painted, for a given context. Also used to grow the note to fit. */
  layoutLines(ctx) {
    ctx.save();
    ctx.font = `${this.fontSize}px ${FONT}`;
    const lines = wrapText(ctx, this.text || '', this.width - STICKY_PAD * 2);
    ctx.restore();
    return lines;
  }

  requiredHeight(ctx) {
    return Math.ceil(this.layoutLines(ctx).length * this.fontSize * LINE_HEIGHT + STICKY_PAD * 2);
  }

  _render(ctx) {
    super._render(ctx);
    if (this.isEditing || !this.text) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-this.width / 2, -this.height / 2, this.width, this.height);
    ctx.clip();
    ctx.font = `${this.fontSize}px ${FONT}`;
    ctx.fillStyle = this.textColor;
    ctx.textBaseline = 'top';
    ctx.globalAlpha *= 1;
    const lines = wrapText(ctx, this.text, this.width - STICKY_PAD * 2);
    lines.forEach((line, i) => {
      ctx.fillText(line, -this.width / 2 + STICKY_PAD, -this.height / 2 + STICKY_PAD + i * this.fontSize * LINE_HEIGHT);
    });
    ctx.restore();
  }
}

classRegistry.setClass(Sticky);
