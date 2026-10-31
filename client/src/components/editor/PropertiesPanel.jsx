import { BringToFront, Copy, SendToBack, Trash2 } from 'lucide-react';
import { PALETTE, STICKY_COLORS, TOOL_CAPS } from '../../canvas/constants.js';
import { useEditorStore } from '../../store/editorStore.js';
import { Avatar, AvatarStack } from '../ui/Avatar.jsx';
import { IconButton } from '../ui/Button.jsx';
import { ColorField, Section, Slider } from './controls.jsx';

function BoardDetails({ board }) {
  return (
    <Section title="Board">
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">Owner</dt>
          <dd className="flex min-w-0 items-center gap-2"><Avatar user={board.owner} size={20} /><span className="truncate">{board.role === 'owner' ? 'You' : board.owner.name}</span></dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">Your access</dt>
          <dd className="capitalize">{board.role}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">Members</dt>
          <dd className="flex items-center gap-2"><AvatarStack users={board.members} total={board.memberCount} size={20} /></dd>
        </div>
      </dl>
    </Section>
  );
}

export function PropertiesPanel({ controller, board, readOnly }) {
  const { tool, selection, defaults } = useEditorStore();
  const open = useEditorStore((s) => s.panelOpen);
  if (!open) return null;

  const caps = selection?.caps ?? TOOL_CAPS[tool];
  const values = selection?.values ?? defaults;
  const live = (patch) => controller?.applyProps(patch, { commit: false });
  const commit = () => controller?.commit();
  const hasStyle = caps && Object.keys(caps).length > 0 && !readOnly;
  const stickyPalette = selection && caps?.fill === 'Note color' ? STICKY_COLORS : PALETTE;

  return (
    <aside aria-label="Properties" className="pointer-events-auto absolute right-3 top-[68px] z-10 max-h-[calc(100%-132px)] w-64 overflow-y-auto rounded-2xl bg-surface shadow-pop">
      <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
        <h2 className="font-display text-sm font-semibold tracking-tight">
          {readOnly ? 'View only' : selection ? (selection.count > 1 ? `${selection.count} objects` : 'Selection') : 'New objects'}
        </h2>
        {selection && !readOnly && (
          <div className="-mr-2 flex">
            <IconButton label="Duplicate (Ctrl+D)" icon={Copy} className="h-7 w-7" onClick={() => controller.duplicate()} />
            <IconButton label="Bring to front (])" icon={BringToFront} className="h-7 w-7" onClick={() => controller.reorder('front')} />
            <IconButton label="Send to back ([)" icon={SendToBack} className="h-7 w-7" onClick={() => controller.reorder('back')} />
            <IconButton label="Delete (Del)" icon={Trash2} className="h-7 w-7 hover:!text-danger" onClick={() => controller.deleteSelection()} />
          </div>
        )}
      </div>

      {hasStyle && (
        <>
          {caps.fill && (
            <Section title={caps.fill}>
              <ColorField label={caps.fill} value={values.fill} palette={stickyPalette} allowTransparent={caps.fill === 'Fill'} onLive={(c) => live({ fill: c })} onCommit={commit} />
            </Section>
          )}
          {caps.stroke && (
            <Section title={caps.stroke}>
              <ColorField label={caps.stroke} value={values.stroke} palette={PALETTE} onLive={(c) => live({ stroke: c })} onCommit={commit} />
            </Section>
          )}
          {caps.strokeWidth && (
            <Section title="Stroke width">
              <Slider label="Stroke width" min={1} max={24} value={values.strokeWidth ?? 2} suffix="px" onLive={(v) => live({ strokeWidth: v })} onCommit={commit} />
            </Section>
          )}
          {caps.fontSize && (
            <Section title="Font size">
              <Slider label="Font size" min={12} max={96} value={values.fontSize ?? 24} suffix="px" onLive={(v) => live({ fontSize: v })} onCommit={commit} />
            </Section>
          )}
          {caps.opacity && (
            <Section title="Opacity">
              <Slider label="Opacity" min={0.1} max={1} step={0.05} value={values.opacity ?? 1} suffix="%" onLive={(v) => live({ opacity: v })} onCommit={commit} />
            </Section>
          )}
        </>
      )}
      {!hasStyle && !readOnly && <p className="px-4 py-3 text-sm text-muted">Pick a drawing tool or select an object to change its style.</p>}
      <BoardDetails board={board} />
    </aside>
  );
}
