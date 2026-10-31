import { ActiveSelection, Canvas, FabricObject, IText, PencilBrush, Point, util } from 'fabric';
import { CAPS, DEFAULTS, FONT, PAPER, PROPS, SHAPE_TOOLS, STICKY_COLORS, ZOOM } from './constants.js';
import { uid } from './ids.js';
import { OpsHistory } from './opsHistory.js';
import { ShadowState } from './shadow.js';
import { buildShape, defaultEnd } from './shapes.js';
import { Sticky } from './Sticky.js';
import { StickyEditor } from './StickyEditor.js';
import { OP, TRANSIENT_KEYS } from './syncKeys.js';

Object.assign(FabricObject.ownDefaults, {
  cornerStyle: 'circle',
  cornerSize: 10,
  cornerColor: '#ffffff',
  cornerStrokeColor: '#5B4BFF',
  transparentCorners: false,
  borderColor: '#5B4BFF',
  borderScaleFactor: 1.5,
  padding: 4,
});

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const canonical = (obj) => JSON.parse(JSON.stringify(obj.toObject(PROPS)));
const TEXT_KEYS = ['text', 'fontSize', 'textColor'];
const TRANSIENT_MIN_INTERVAL_MS = 50;
const TRANSIENT_REVERT_MS = 4000;

/**
 * Owns the Fabric canvas. React never touches Fabric objects directly: it calls methods here
 * and subscribes to events:
 *   'tool' | 'selection' | 'history' | 'viewport' | 'defaults'   (UI state)
 *   'ops'        local operations to send to the server ([{ type, ... }])
 *   'transient'  live drag preview to relay (not persisted)
 *   'pointer'    scene coordinates of the local pointer (for remote cursors)
 *   'change'     a local edit was committed; 'remote' remote changes were applied
 *
 * Every finished local edit ends in commit(): it diffs the canvas against the shadow (the last
 * committed/received state), records forward+inverse operations for undo, and emits 'ops'.
 * Remote operations are applied through the same machinery but update the shadow too, so they are
 * never mistaken for local edits and never echo back.
 */
export class CanvasController {
  constructor(host, { readOnly = false } = {}) {
    this.host = host;
    this.readOnly = readOnly;
    this.listeners = {};
    this.tool = 'select';
    this.defaults = { ...DEFAULTS };
    this.shadow = new ShadowState();
    this.history = new OpsHistory();
    this.clipboard = null;
    this.pasteCount = 0;
    this.draft = null;
    this.placing = null;
    this.panning = null;
    this.spaceDown = false;
    this.restoring = false;
    this.disposed = false;
    this.commitTimer = null;
    this.suppressCommit = 0;
    this.opChain = Promise.resolve(); // serializes remote/undo applications
    this.idleWaiters = [];
    this.transients = new Map(); // id -> { base, timer } for live previews of other people's drags
    this.lastTransientAt = 0;
    this.insets = { top: 84, bottom: 72, left: 84, right: 40 }; // floating UI the content must clear

    this.element = document.createElement('canvas');
    host.appendChild(this.element);
    this.canvas = new Canvas(this.element, {
      width: host.clientWidth || 800,
      height: host.clientHeight || 600,
      preserveObjectStacking: true,
      fireMiddleClick: true,
      stopContextMenu: true,
      selectionColor: 'rgba(91, 75, 255, 0.08)',
      selectionBorderColor: '#5B4BFF',
      selectionLineWidth: 1,
    });
    this.stickyEditor = new StickyEditor(host, this.canvas, (sticky) => this.#afterStickyEdit(sticky));

    this.#bind();
    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(host);
    document.fonts?.ready.then(() => this.#remeasureText());

    this.#applyInteractivity();
    this.#emitViewport();
  }

  /* ───────────── events ───────────── */

  on(event, fn) {
    (this.listeners[event] ||= new Set()).add(fn);
    return () => this.listeners[event].delete(fn);
  }

  #emit(event, payload) {
    this.listeners[event]?.forEach((fn) => fn(payload));
  }

  #bind() {
    const c = this.canvas;
    c.on('mouse:down', (o) => this.#down(o));
    c.on('mouse:move', (o) => {
      this.#move(o);
      if (o.scenePoint) this.#emit('pointer', { x: o.scenePoint.x, y: o.scenePoint.y });
    });
    c.on('mouse:up', (o) => {
      this.#up(o);
      this.#flushIdle();
    });
    c.on('mouse:wheel', (o) => this.#wheel(o));
    c.on('mouse:dblclick', (o) => {
      if (o.target instanceof Sticky && !this.readOnly) this.stickyEditor.open(o.target);
    });
    c.on('object:modified', ({ target }) => {
      if (target instanceof Sticky) this.#normalizeSticky(target);
      this.commit();
      this.#emitSelection();
    });
    for (const event of ['object:moving', 'object:scaling', 'object:rotating']) c.on(event, ({ target }) => this.#sendTransient(target));
    const select = () => this.#emitSelection();
    c.on('selection:created', select);
    c.on('selection:updated', select);
    c.on('selection:cleared', select);
    c.on('path:created', ({ path }) => {
      path.set({ id: uid(), kind: 'pen', strokeUniform: true, opacity: this.defaults.opacity });
      this.commit();
    });
    c.on('text:editing:exited', ({ target }) => {
      if (target?.kind === 'text' && !target.text.trim()) c.remove(target); // never keep empty text
      this.commit();
      this.#emitSelection();
    });
  }

  /* ───────────── tools & interaction state ───────────── */

  setTool(tool) {
    if (this.readOnly && tool !== 'select' && tool !== 'hand') return;
    this.stickyEditor.close();
    this.#exitTextEditing();
    this.tool = tool;
    if (tool === 'pen') this.#configureBrush();
    if (tool !== 'select') this.canvas.discardActiveObject();
    this.#applyInteractivity();
    this.#emit('tool', tool);
  }

  setPanOverride(down) {
    if (this.spaceDown === down) return;
    this.spaceDown = down;
    this.#applyInteractivity();
  }

  setReadOnly(readOnly) {
    this.readOnly = readOnly;
    if (readOnly) this.canvas.discardActiveObject();
    this.#applyInteractivity();
  }

  #applyInteractivity() {
    const c = this.canvas;
    const t = this.tool;
    const pan = this.readOnly || this.spaceDown || t === 'hand';
    c.isDrawingMode = !pan && t === 'pen';
    c.skipTargetFind = pan || t !== 'select';
    c.selection = !pan && t === 'select';
    const cursor = pan ? 'grab' : t === 'select' ? 'default' : 'crosshair';
    c.defaultCursor = cursor;
    c.hoverCursor = pan ? 'grab' : t === 'select' ? 'move' : 'crosshair';
    c.freeDrawingCursor = 'crosshair';
    c.setCursor(cursor);
    c.requestRenderAll();
  }

  #configureBrush() {
    const brush = new PencilBrush(this.canvas);
    brush.color = this.defaults.stroke;
    brush.width = this.defaults.strokeWidth;
    this.canvas.freeDrawingBrush = brush;
  }

  #exitTextEditing() {
    const active = this.canvas.getActiveObject();
    if (active instanceof IText && active.isEditing) active.exitEditing();
  }

  #style() {
    const { fill, stroke, strokeWidth, opacity } = this.defaults;
    return { fill, stroke, strokeWidth, opacity };
  }

  /* ───────────── pointer handling ───────────── */

  #panWanted(e) {
    return this.readOnly || this.spaceDown || this.tool === 'hand' || e.button === 1;
  }

  #down(opt) {
    if (this.#panWanted(opt.e)) {
      this.panning = { last: opt.viewportPoint };
      this.canvas.setCursor('grabbing');
      return;
    }
    if (this.tool === 'text' || this.tool === 'sticky') this.placing = opt.scenePoint;
    else if (SHAPE_TOOLS.includes(this.tool)) this.draft = { kind: this.tool, p0: opt.scenePoint, obj: null, moved: false };
  }

  #move(opt) {
    if (this.panning) {
      const p = opt.viewportPoint;
      this.canvas.relativePan(new Point(p.x - this.panning.last.x, p.y - this.panning.last.y));
      this.panning.last = p;
      this.#emitViewport();
      return;
    }
    const d = this.draft;
    if (!d) return;
    const p = opt.scenePoint;
    if (!d.moved && Math.hypot(p.x - d.p0.x, p.y - d.p0.y) * this.canvas.getZoom() < 4) return;
    d.moved = true;
    if (d.obj) this.canvas.remove(d.obj);
    d.obj = buildShape(d.kind, d.p0, p, this.#style(), opt.e.shiftKey);
    this.canvas.add(d.obj);
  }

  #up() {
    if (this.panning) {
      this.panning = null;
      this.canvas.setCursor(this.canvas.defaultCursor);
      return;
    }
    if (this.draft) return this.#finishDraft();
    if (this.placing) {
      const p = this.placing;
      this.placing = null;
      if (this.tool === 'text') this.#placeText(p);
      else if (this.tool === 'sticky') this.#placeSticky(p);
    }
  }

  #finishDraft() {
    const { kind, p0, moved } = this.draft;
    let shape = this.draft.obj;
    this.draft = null;
    if (!shape || !moved) {
      if (shape) this.canvas.remove(shape);
      shape = buildShape(kind, p0, defaultEnd(kind, p0), this.#style());
      this.canvas.add(shape);
    }
    shape.set({ id: uid(), kind });
    shape.setCoords();
    this.setTool('select');
    this.canvas.setActiveObject(shape);
    this.commit();
  }

  #placeText(p) {
    const text = new IText('', {
      left: p.x,
      top: p.y,
      id: uid(),
      kind: 'text',
      fontFamily: FONT,
      fontSize: this.defaults.fontSize,
      fill: this.defaults.stroke,
      opacity: this.defaults.opacity,
    });
    this.canvas.add(text);
    this.setTool('select');
    this.canvas.setActiveObject(text);
    text.enterEditing();
    text.hiddenTextarea?.focus();
  }

  #placeSticky(p) {
    const count = this.canvas.getObjects().filter((o) => o instanceof Sticky).length;
    const note = new Sticky({
      left: p.x - 100,
      top: p.y - 100,
      id: uid(),
      fill: STICKY_COLORS[count % 5],
      opacity: this.defaults.opacity,
    });
    this.canvas.add(note);
    this.setTool('select');
    this.canvas.setActiveObject(note);
    this.stickyEditor.open(note);
  }

  #normalizeSticky(note) {
    // Resizing a sticky changes its box, not the scale, so text keeps its size and re-wraps.
    note.set({ width: note.width * note.scaleX, height: note.height * note.scaleY, scaleX: 1, scaleY: 1 });
    note.setCoords();
  }

  #afterStickyEdit(note) {
    const needed = note.requiredHeight(this.canvas.getContext());
    if (needed > note.height) note.set('height', needed);
    note.setCoords();
    this.commit();
    this.#emitSelection();
  }

  /* ───────────── viewport ───────────── */

  #wheel(opt) {
    const e = opt.e;
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      const zoom = clamp(this.canvas.getZoom() * 0.999 ** e.deltaY, ZOOM.min, ZOOM.max);
      this.canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), zoom);
    } else {
      this.canvas.relativePan(new Point(-e.deltaX, -e.deltaY));
    }
    this.#emitViewport();
  }

  #emitViewport() {
    if (this.stickyEditor.isOpen) this.stickyEditor.close();
    const v = this.canvas.viewportTransform;
    this.#emit('viewport', { zoom: this.canvas.getZoom(), x: v[4], y: v[5] });
  }

  #resize() {
    if (this.disposed) return;
    const { clientWidth: width, clientHeight: height } = this.host;
    if (!width || !height) return;
    this.canvas.setDimensions({ width, height });
    this.#emitViewport();
  }

  zoomTo(zoom, center) {
    const origin = center ?? new Point(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2);
    this.canvas.zoomToPoint(origin, clamp(zoom, ZOOM.min, ZOOM.max));
    this.#emitViewport();
  }

  zoomBy(factor) {
    this.zoomTo(this.canvas.getZoom() * factor);
  }

  resetZoom() {
    this.zoomTo(1);
  }

  /** Space reserved by floating UI (e.g. the properties panel) when fitting content. */
  setInsets(insets) {
    this.insets = { ...this.insets, ...insets };
  }

  zoomToFit() {
    const b = this.#contentBounds();
    const { top, bottom, left, right } = this.insets;
    const W = this.canvas.getWidth() - left - right;
    const H = this.canvas.getHeight() - top - bottom;
    if (!b || W <= 0 || H <= 0) {
      this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    } else {
      const z = clamp(Math.min(W / b.width, H / b.height), ZOOM.min, 1.5);
      this.canvas.setViewportTransform([z, 0, 0, z, left + W / 2 - (b.left + b.width / 2) * z, top + H / 2 - (b.top + b.height / 2) * z]);
    }
    this.#emitViewport();
  }

  #contentBounds() {
    const objects = this.canvas.getObjects();
    if (!objects.length) return null;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const o of objects) {
      for (const p of o.getCoords()) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    return { left: minX, top: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  /* ───────────── commit, history & sync ───────────── */

  serialize() {
    // canvas.toObject realizes ActiveSelection transforms, so grouped selections serialize correctly.
    return this.canvas.toObject(PROPS).objects;
  }

  /**
   * Diffs the canvas against the shadow and records/emits the difference. The only place a local
   * edit is "finished". A no-op if nothing changed.
   */
  commit() {
    clearTimeout(this.commitTimer);
    this.commitTimer = null;
    if (this.restoring || this.disposed || this.suppressCommit || this.readOnly) return;
    const { forward, inverse } = this.shadow.diff(this.serialize());
    if (!forward.length) return;
    this.history.push({ forward, inverse });
    this.#emit('history', this.historyState());
    this.#emit('ops', forward);
    this.#emit('change');
  }

  commitSoon(delay = 400) {
    clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.commit(), delay);
  }

  historyState() {
    return { canUndo: this.history.canUndo, canRedo: this.history.canRedo };
  }

  /** Initial load: replaces the canvas, resets the shadow and clears history. */
  async load(objects) {
    try {
      await Promise.race([document.fonts?.load('20px Onest'), new Promise((r) => setTimeout(r, 1500))]);
    } catch {
      /* fonts are best-effort */
    }
    await this.replaceAll(objects);
    this.history.reset();
    this.#emit('history', this.historyState());
  }

  /** Replaces every object (initial load, or a full resync after a long disconnect). */
  async replaceAll(objects) {
    this.restoring = true;
    try {
      this.stickyEditor.close();
      const vpt = [...this.canvas.viewportTransform];
      this.canvas.discardActiveObject();
      await this.canvas.loadFromJSON({ objects });
      if (this.disposed) return;
      this.canvas.setViewportTransform(vpt);
      this.shadow.reset(this.serialize());
      this.canvas.requestRenderAll();
    } finally {
      this.restoring = false;
    }
    this.#emit('selection', null);
  }

  async undo() {
    await this.#step('undo');
  }

  async redo() {
    await this.#step('redo');
  }

  async #step(direction) {
    if (this.readOnly) return;
    if (this.commitTimer) this.commit();
    const ops = this.history[direction]();
    if (!ops) return;
    await this.#enqueue(async () => {
      await this.#applyOps(ops, []);
      this.#emit('ops', ops); // undo/redo are ordinary operations for everyone else
      this.#emit('change');
    });
    this.#emit('history', this.historyState());
  }

  /**
   * Applies operations received from the server. `getPending` returns this client's sent-but-
   * unacknowledged ops at the moment of application: properties they touch are skipped, because
   * those local ops will be sequenced later and therefore win (last writer wins, server order).
   */
  applyRemoteOps(ops, getPending = () => []) {
    return this.#enqueue(async () => {
      await this.#whenIdle();
      await this.#applyOps(ops, getPending());
      this.#emit('remote');
    });
  }

  /** Re-applies ops already sent (after a full resync). Updates canvas + shadow; emits nothing. */
  applyLocalOps(ops) {
    return this.#enqueue(() => this.#applyOps(ops, []));
  }

  #enqueue(task) {
    this.opChain = this.opChain.then(task, task).catch((err) => console.error('Applying operations failed:', err));
    return this.opChain;
  }

  /** Remote changes wait while the user is mid-drag/mid-draw so objects don't jump under the cursor. */
  #busy() {
    return Boolean(this.canvas._currentTransform || this.draft || this.panning);
  }

  #whenIdle() {
    if (!this.#busy()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  #flushIdle() {
    if (this.#busy()) return;
    const waiters = this.idleWaiters.splice(0);
    waiters.forEach((resolve) => resolve());
  }

  async #applyOps(ops, pending) {
    if (this.disposed) return;
    const protect = new Map();
    for (const p of pending) {
      const id = p.id ?? p.object?.id;
      if (!id) continue;
      const entry = protect.get(id) ?? { keys: new Set(), deleted: false, reordered: false };
      if (p.type === OP.UPDATED) Object.keys(p.patch).forEach((k) => entry.keys.add(k));
      if (p.type === OP.DELETED) entry.deleted = true;
      if (p.type === OP.REORDERED) entry.reordered = true;
      protect.set(id, entry);
    }

    // Phase 1 (async): build Fabric objects for creations. Nothing touches the canvas yet, so a
    // local commit during this await still diffs against an unchanged shadow.
    const present = new Set(this.canvas.getObjects().map((o) => o.id));
    const toCreate = ops.filter((o) => o.type === OP.CREATED && !present.has(o.object.id) && !protect.get(o.object.id)?.deleted);
    const created = new Map();
    if (toCreate.length) {
      const made = await util.enlivenObjects(toCreate.map((o) => structuredClone(o.object)));
      toCreate.forEach((o, i) => created.set(o.object.id, made[i]));
    }
    if (this.disposed) return;

    // Phase 2 (sync, atomic): mutate canvas and shadow together.
    const byId = new Map(this.canvas.getObjects().map((o) => [o.id, o]));
    this.suppressCommit += 1;
    try {
      this.#withSelectionPaused(() => {
        for (const op of ops) this.#applyOne(op, { byId, created, protect });
      });
    } finally {
      this.suppressCommit -= 1;
    }
    this.canvas.requestRenderAll();
    this.#emitSelection();
    this.#emit('history', this.historyState());
  }

  #withSelectionPaused(fn) {
    const active = this.canvas.getActiveObject();
    if (!(active instanceof ActiveSelection)) return fn();
    // Children of a multi-selection use group-relative coordinates, so release them while mutating.
    const ids = active.getObjects().map((o) => o.id);
    this.canvas.discardActiveObject();
    fn();
    const again = this.canvas.getObjects().filter((o) => ids.includes(o.id));
    if (again.length > 1) this.canvas.setActiveObject(new ActiveSelection(again, { canvas: this.canvas }));
    else if (again.length === 1) this.canvas.setActiveObject(again[0]);
    return undefined;
  }

  #indexAfter(afterId, byId) {
    const list = this.canvas.getObjects();
    if (afterId === null) return 0;
    if (typeof afterId === 'string') {
      const anchor = byId.get(afterId);
      const i = anchor ? list.indexOf(anchor) : -1;
      if (i !== -1) return i + 1;
    }
    return list.length;
  }

  #applyOne(op, { byId, created, protect }) {
    const id = op.id ?? op.object?.id;
    this.#dropTransient(id);
    const guard = protect.get(id);

    switch (op.type) {
      case OP.CREATED: {
        const obj = created.get(id);
        if (!obj || byId.has(id)) return;
        this.canvas.insertAt(this.#indexAfter(op.afterId, byId), obj);
        byId.set(id, obj);
        this.shadow.upsert(canonical(obj), op.afterId);
        return;
      }
      case OP.UPDATED: {
        const obj = byId.get(id);
        if (!obj || guard?.deleted) return;
        const editingText = obj.isEditing || this.stickyEditor.sticky === obj;
        const patch = {};
        for (const [key, value] of Object.entries(op.patch)) {
          if (guard?.keys.has(key)) continue; // my pending edit wins
          if (editingText && TEXT_KEYS.includes(key)) continue; // don't pull text from under the cursor
          if (obj instanceof IText && (key === 'width' || key === 'height')) continue;
          patch[key] = value;
        }
        if (!Object.keys(patch).length) return;
        obj.set(patch);
        obj.setCoords();
        obj.dirty = true;
        this.shadow.upsert(canonical(obj));
        return;
      }
      case OP.DELETED: {
        const obj = byId.get(id);
        if (!obj) return;
        if (this.stickyEditor.sticky === obj) this.stickyEditor.close();
        this.canvas.remove(obj);
        byId.delete(id);
        this.shadow.remove(id);
        return;
      }
      case OP.REORDERED: {
        const obj = byId.get(id);
        if (!obj || guard?.reordered || guard?.deleted) return;
        this.canvas.remove(obj);
        this.canvas.insertAt(this.#indexAfter(op.afterId, byId), obj);
        this.shadow.move(id, op.afterId);
        return;
      }
      default:
    }
  }

  /* ───────────── live drag previews ───────────── */

  #sendTransient(target) {
    if (!target?.id || target instanceof ActiveSelection || this.readOnly) return;
    const now = Date.now();
    if (now - this.lastTransientAt < TRANSIENT_MIN_INTERVAL_MS) return;
    this.lastTransientAt = now;
    const patch = {};
    for (const k of TRANSIENT_KEYS) patch[k] = target[k];
    this.#emit('transient', { id: target.id, patch });
  }

  /** Shows another user's in-progress drag. The authoritative final op replaces it; if that never
   *  arrives (they disconnected mid-drag) the object snaps back after a few seconds. */
  applyTransient({ id, patch }) {
    const obj = this.canvas.getObjects().find((o) => o.id === id);
    if (!obj || this.canvas.getActiveObject() === obj || obj instanceof ActiveSelection || this.#busy()) return;
    let entry = this.transients.get(id);
    if (!entry) {
      entry = { base: Object.fromEntries(TRANSIENT_KEYS.map((k) => [k, obj[k]])) };
      this.transients.set(id, entry);
    }
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      this.transients.delete(id);
      obj.set(entry.base);
      obj.setCoords();
      this.shadow.upsert(canonical(obj));
      this.canvas.requestRenderAll();
    }, TRANSIENT_REVERT_MS);
    obj.set(patch);
    obj.setCoords();
    this.shadow.upsert(canonical(obj)); // keep the shadow equal to the canvas so this never reads as a local edit
    this.canvas.requestRenderAll();
  }

  #dropTransient(id) {
    const entry = this.transients.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.transients.delete(id);
  }

  #remeasureText() {
    if (this.disposed) return;
    this.canvas.getObjects().forEach((o) => {
      if (o instanceof IText) {
        o.initDimensions();
        o.setCoords();
      }
    });
    this.canvas.requestRenderAll();
  }

  /** JPEG preview of the content, cropped to the dashboard card's 16:10 ratio. Null if empty. */
  thumbnail(width = 480) {
    const b = this.#contentBounds();
    if (!b) return null;
    const pad = 40;
    let w = b.width + pad * 2;
    let h = b.height + pad * 2;
    if (w / h > 1.6) h = w / 1.6;
    else w = h * 1.6;
    // Fabric crops in *screen* space and keeps the current zoom, so export under an identity
    // viewport to make left/top scene coordinates regardless of how the user has panned or zoomed.
    const previous = this.canvas.backgroundColor;
    const vpt = [...this.canvas.viewportTransform];
    this.canvas.backgroundColor = PAPER;
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    try {
      return this.canvas.toDataURL({
        format: 'jpeg',
        quality: 0.72,
        left: b.left + b.width / 2 - w / 2,
        top: b.top + b.height / 2 - h / 2,
        width: w,
        height: h,
        multiplier: width / w,
        enableRetinaScaling: false,
      });
    } finally {
      this.canvas.backgroundColor = previous;
      this.canvas.setViewportTransform(vpt);
    }
  }

  /* ───────────── selection & styling ───────────── */

  #emitSelection() {
    this.#emit('selection', this.getSelection());
  }

  getSelection() {
    const objects = this.canvas.getActiveObjects();
    if (!objects.length) return null;
    const caps = {};
    const values = {};
    for (const o of objects) {
      for (const [key, label] of Object.entries(CAPS[o.kind] ?? {})) {
        caps[key] ??= label;
        if (!(key in values)) values[key] = this.#read(o, key);
      }
    }
    return { count: objects.length, caps, values };
  }

  #read(o, key) {
    if (key === 'fill' || key === 'stroke') return typeof o[key] === 'string' && o[key] ? o[key] : 'transparent';
    return o[key];
  }

  /** Styles the selection, or the defaults for new objects when nothing is selected. */
  applyProps(patch, { commit = true } = {}) {
    const objects = this.canvas.getActiveObjects();
    if (!objects.length) {
      this.defaults = { ...this.defaults, ...patch };
      if (this.tool === 'pen') this.#configureBrush();
      this.#emit('defaults', this.defaults);
      return;
    }
    for (const o of objects) {
      const caps = CAPS[o.kind] ?? {};
      for (const [key, value] of Object.entries(patch)) {
        if (key in caps) o.set(key, value === 'transparent' && key === 'fill' ? null : value);
      }
      o.setCoords();
      o.dirty = true;
    }
    this.canvas.requestRenderAll();
    this.#emitSelection();
    if (commit) this.commit();
  }

  /* ───────────── editing commands ───────────── */

  deleteSelection() {
    const objects = this.canvas.getActiveObjects();
    if (!objects.length || this.readOnly) return;
    this.canvas.discardActiveObject();
    this.canvas.remove(...objects);
    this.commit();
    this.#emitSelection();
  }

  selectAll() {
    this.setTool('select');
    const objects = this.canvas.getObjects();
    if (!objects.length) return;
    this.canvas.discardActiveObject();
    this.canvas.setActiveObject(new ActiveSelection(objects, { canvas: this.canvas }));
    this.canvas.requestRenderAll();
  }

  clearSelection() {
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  async copy() {
    const active = this.canvas.getActiveObject();
    if (!active) return false;
    this.clipboard = await active.clone(PROPS);
    this.pasteCount = 0;
    return true;
  }

  async paste() {
    if (!this.clipboard || this.readOnly) return;
    const clone = await this.clipboard.clone(PROPS);
    this.pasteCount += 1;
    const offset = 24 * this.pasteCount;
    this.canvas.discardActiveObject();
    clone.set({ left: clone.left + offset, top: clone.top + offset, evented: true });
    if (clone instanceof ActiveSelection) {
      clone.canvas = this.canvas;
      clone.forEachObject((o) => {
        o.set('id', uid());
        this.canvas.add(o);
      });
      clone.setCoords();
    } else {
      clone.set('id', uid());
      this.canvas.add(clone);
    }
    this.canvas.setActiveObject(clone);
    this.canvas.requestRenderAll();
    this.commit();
  }

  async cut() {
    if (await this.copy()) this.deleteSelection();
  }

  async duplicate() {
    if (await this.copy()) await this.paste();
  }

  nudge(dx, dy) {
    const objects = this.canvas.getActiveObjects();
    if (!objects.length || this.readOnly) return;
    const active = this.canvas.getActiveObject();
    active.set({ left: active.left + dx, top: active.top + dy });
    active.setCoords();
    this.canvas.requestRenderAll();
    this.commitSoon();
  }

  reorder(direction) {
    const objects = this.canvas.getActiveObjects();
    if (!objects.length || this.readOnly) return;
    const front = direction === 'front';
    (front ? objects : [...objects].reverse()).forEach((o) => (front ? this.canvas.bringObjectToFront(o) : this.canvas.sendObjectToBack(o)));
    this.canvas.requestRenderAll();
    this.commit(); // the diff turns the new stacking order into reorder operations
  }

  /* ───────────── lifecycle ───────────── */

  dispose() {
    this.#emit('dispose');
    this.disposed = true;
    clearTimeout(this.commitTimer);
    this.transients.forEach((t) => clearTimeout(t.timer));
    this.resizeObserver.disconnect();
    this.stickyEditor.close();
    this.listeners = {};
    this.canvas.dispose();
    this.host.replaceChildren();
  }
}
