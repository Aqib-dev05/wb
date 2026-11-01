// Pure maths for "export the board as an image". Kept free of Fabric/DOM so it can be unit tested.
//
// Browsers refuse (or silently blank) canvases past a size limit: iOS Safari caps a canvas at
// 16,777,216 pixels, desktop browsers at about 16k per side. A big board at 2x easily crosses that,
// so the requested scale is lowered until the result fits, and the caller is told it happened.

export const EXPORT_PADDING = 40; // scene px of paper around the content
export const MAX_SIDE = 8192;
export const MAX_PIXELS = 16_000_000;

/**
 * @param bounds  { left, top, width, height } of the content in scene coordinates
 * @param scale   wanted pixels per scene pixel (1 = actual size, 2 = sharp on retina)
 * @returns the crop rectangle (scene px), the multiplier to render it at, and the pixel size of the image
 */
export function planExport(bounds, { scale = 2, padding = EXPORT_PADDING } = {}) {
  const width = Math.ceil(bounds.width + padding * 2);
  const height = Math.ceil(bounds.height + padding * 2);
  const limit = Math.min(MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  const multiplier = Math.min(scale, limit);
  return {
    left: Math.floor(bounds.left - padding),
    top: Math.floor(bounds.top - padding),
    width,
    height,
    multiplier,
    pxWidth: Math.max(1, Math.round(width * multiplier)),
    pxHeight: Math.max(1, Math.round(height * multiplier)),
    clamped: multiplier < scale,
  };
}

/** "My board / v2?" -> "my-board-v2": a safe file name from a board title. */
export function fileSlug(title, fallback = 'board') {
  const slug = String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}
