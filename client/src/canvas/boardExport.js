import { fileSlug } from './exportPlan.js';

// Turns the canvas the controller rendered into a file the person can keep.

const toBlob = (canvas, type) =>
  new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image was too large for this browser to create. Try a smaller scale.'))), type));

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * @param controller  CanvasController
 * @param title       board title (file name)
 * @param format      'png' | 'pdf'
 * @param transparent PNG only: leave the paper out
 * @returns { name, size, pxWidth, pxHeight, clamped } or null when the board is empty
 */
export async function exportBoard(controller, { title, format, transparent = false, scale = 2 }) {
  const rendered = controller.renderExport({ scale, transparent: format === 'png' && transparent });
  if (!rendered) return null;
  const { canvas, plan } = rendered;
  const base = fileSlug(title);

  let blob;
  let name;
  if (format === 'pdf') {
    // jsPDF is large and only needed here, so it is fetched when someone actually exports a PDF.
    const { jsPDF } = await import('jspdf');
    // One page the size of the content. 96 css px = 72 pt, so it opens at the size it had on screen.
    const w = (plan.width * 72) / 96;
    const h = (plan.height * 72) / 96;
    const pdf = new jsPDF({ unit: 'pt', format: [w, h], orientation: w >= h ? 'landscape' : 'portrait', compress: true });
    pdf.setProperties({ title: String(title ?? 'Board'), creator: 'CollabBoard' });
    pdf.addImage(canvas, 'PNG', 0, 0, w, h, undefined, 'FAST');
    blob = pdf.output('blob');
    name = `${base}.pdf`;
  } else {
    blob = await toBlob(canvas, 'image/png');
    name = `${base}.png`;
  }
  download(blob, name);
  return { name, size: blob.size, pxWidth: plan.pxWidth, pxHeight: plan.pxHeight, clamped: plan.clamped };
}
