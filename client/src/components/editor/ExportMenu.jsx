import { useState } from 'react';
import { Download, FileImage, FileText, ImageOff } from 'lucide-react';
import { exportBoard } from '../../canvas/boardExport.js';
import { useUiStore } from '../../store/uiStore.js';
import { IconButton } from '../ui/Button.jsx';
import { Menu } from '../ui/Menu.jsx';

/** Download the whole board (not just the visible part) as PNG, transparent PNG or PDF. */
export function ExportMenu({ controller, title }) {
  const toast = useUiStore((s) => s.toast);
  const [busy, setBusy] = useState(false);

  const run = (options) => async () => {
    if (!controller || busy) return;
    setBusy(true);
    try {
      const result = await exportBoard(controller, { title, ...options });
      if (!result) toast('This board is empty, so there is nothing to export yet.', 'info');
      else if (result.clamped) toast(`Exported ${result.name} at ${result.pxWidth}×${result.pxHeight}px: the board is too large for full resolution in this browser.`, 'info');
      else toast(`Exported ${result.name}`, 'success');
    } catch (err) {
      toast(err.message || 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Menu
      trigger={({ open }) => <IconButton label="Export board" icon={Download} active={open} aria-busy={busy} />}
      items={[
        { label: 'PNG image', icon: FileImage, onSelect: run({ format: 'png' }) },
        { label: 'PNG, transparent', icon: ImageOff, onSelect: run({ format: 'png', transparent: true }) },
        { label: 'PDF document', icon: FileText, onSelect: run({ format: 'pdf' }) },
      ]}
    />
  );
}
