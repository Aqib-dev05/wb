// Wire-protocol constants shared with the server. Keep PATCH_KEYS in sync with
// server/src/validators/ops.validators.js (the server rejects any other property).
export const OP = {
  CREATED: 'object:created',
  UPDATED: 'object:updated',
  DELETED: 'object:deleted',
  REORDERED: 'object:reordered',
};

export const PATCH_KEYS = [
  'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'flipX', 'flipY', 'skewX', 'skewY',
  'fill', 'stroke', 'strokeWidth', 'opacity', 'rx', 'ry', 'text', 'fontSize', 'textColor', 'path',
  'backgroundColor', 'lineHeight',
];

// Properties shown to others while an object is being dragged (not persisted).
export const TRANSIENT_KEYS = ['left', 'top', 'scaleX', 'scaleY', 'angle'];
