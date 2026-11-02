import { z } from 'zod';

// Everything arriving over a socket is untrusted. These schemas are an allowlist: unknown object
// types, unknown property names, odd value shapes and oversized payloads never reach the state.
// Keep PATCH_KEYS in sync with client/src/canvas/syncKeys.js.

export const OBJECT_TYPES = ['Rect', 'Ellipse', 'Triangle', 'Path', 'IText', 'Sticky'];

export const PATCH_KEYS = new Set([
  'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'flipX', 'flipY', 'skewX', 'skewY',
  'fill', 'stroke', 'strokeWidth', 'opacity', 'rx', 'ry', 'text', 'fontSize', 'textColor', 'path',
  'backgroundColor', 'lineHeight',
]);

const EXTRA_OBJECT_KEYS = [
  'id', 'type', 'kind', 'version', 'originX', 'originY', 'strokeUniform', 'strokeLineCap', 'strokeLineJoin',
  'strokeMiterLimit', 'strokeDashArray', 'strokeDashOffset', 'fontFamily', 'fontWeight', 'fontStyle',
  'underline', 'linethrough', 'overline', 'textAlign', 'charSpacing', 'shadow', 'visible', 'paintFirst',
  'styles', 'direction', 'fillRule', 'globalCompositeOperation', 'pathOffset',
];
const OBJECT_KEYS = new Set([...PATCH_KEYS, ...EXTRA_OBJECT_KEYS]);

const MAX_OBJECT_BYTES = 250_000;
const MAX_OPS_PER_BATCH = 500;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Recursively validates JSON-like data; throws on anything that isn't safe to store and relay. */
function clean(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 20_000) throw new Error('string too long');
    return value;
  }
  if (Array.isArray(value) && depth < 4) {
    if (value.length > 50_000) throw new Error('array too long');
    return value.map((v) => clean(v, depth + 1));
  }
  if (isPlainObject(value) && depth < 3) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // Mongo field names must not start with "$" or contain "."; "__proto__" would poison objects.
      if (k.startsWith('$') || k.includes('.') || k === '__proto__') throw new Error('bad key');
      out[k] = clean(v, depth + 1);
    }
    return out;
  }
  throw new Error('unsupported value');
}

const id = z.string().min(1).max(64);

const canvasObject = z
  .looseObject({ id, type: z.enum(OBJECT_TYPES) })
  .transform((obj, ctx) => {
    try {
      const out = {};
      for (const [k, v] of Object.entries(obj)) if (OBJECT_KEYS.has(k)) out[k] = clean(v);
      if (JSON.stringify(out).length > MAX_OBJECT_BYTES) throw new Error('object too large');
      return out;
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: `Invalid object: ${err.message}` });
      return z.NEVER;
    }
  });

const patch = z
  .record(z.string(), z.unknown())
  .transform((p, ctx) => {
    try {
      const out = {};
      for (const [k, v] of Object.entries(p)) {
        if (!PATCH_KEYS.has(k)) throw new Error(`property "${k}" cannot be changed`);
        out[k] = clean(v);
      }
      if (!Object.keys(out).length) throw new Error('empty patch');
      if (JSON.stringify(out).length > MAX_OBJECT_BYTES) throw new Error('patch too large');
      return out;
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: `Invalid patch: ${err.message}` });
      return z.NEVER;
    }
  });

const op = z.discriminatedUnion('type', [
  z.object({ type: z.literal('object:created'), object: canvasObject, afterId: id.nullable().optional() }),
  z.object({ type: z.literal('object:updated'), id, patch }),
  z.object({ type: z.literal('object:deleted'), id }),
  z.object({ type: z.literal('object:reordered'), id, afterId: id.nullable() }),
]);

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const num = z.number().finite();

export const joinSchema = z.object({
  boardId: objectId,
  lastSeq: z.number().int().min(0).optional(),
  pendingBatchIds: z.array(id).max(100).optional(),
});
export const submitSchema = z.object({
  boardId: objectId,
  batchId: id,
  ops: z.array(op).min(1).max(MAX_OPS_PER_BATCH),
});
export const cursorSchema = z.object({ boardId: objectId, x: num, y: num });
export const transientSchema = z.object({
  boardId: objectId,
  id,
  patch: z.object({ left: num, top: num, scaleX: num.optional(), scaleY: num.optional(), angle: num.optional(), width: num.optional(), height: num.optional() }),
});
export const leaveSchema = z.object({ boardId: objectId });

// ---- live calls (WebRTC signalling) ----
const mediaFlags = z.object({ audio: z.boolean().optional(), video: z.boolean().optional() });
export const callJoinSchema = z.object({ boardId: objectId, audio: z.boolean().optional(), video: z.boolean().optional() });
export const callLeaveSchema = z.object({ boardId: objectId });
export const callMediaSchema = z.object({ boardId: objectId }).extend(mediaFlags.shape);
export const callSignalSchema = z.object({
  boardId: objectId,
  to: z.string().min(1).max(64),
  description: z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(60_000) }).optional(),
  candidate: z.object({
    candidate: z.string().max(2_000),
    sdpMid: z.string().max(64).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }).nullable().optional(),
}).refine((s) => s.description || s.candidate !== undefined, { message: 'Nothing to signal' });
