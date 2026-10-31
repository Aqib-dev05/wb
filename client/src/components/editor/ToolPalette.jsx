import { useRef, useState } from 'react';
import { ArrowUpRight, Circle, Hand, Minus, MousePointer2, Pencil, Shapes, Square, StickyNote, Triangle, Type } from 'lucide-react';
import { SHAPE_TOOLS } from '../../canvas/constants.js';
import { useDismiss } from '../../hooks/useCommon.js';
import { useEditorStore } from '../../store/editorStore.js';
import { cn } from '../../utils/format.js';

const SHAPES = {
  rect: { label: 'Rectangle', key: 'R', icon: Square },
  ellipse: { label: 'Ellipse', key: 'O', icon: Circle },
  triangle: { label: 'Triangle', key: 'G', icon: Triangle },
  line: { label: 'Line', key: 'L', icon: Minus },
  arrow: { label: 'Arrow', key: 'A', icon: ArrowUpRight },
};

function ToolButton({ label, shortcut, icon: Icon, active, onClick, ...rest }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
      className={cn('flex h-10 w-10 items-center justify-center rounded-xl transition', active ? 'bg-primary text-primary-ink shadow-sm' : 'text-muted hover:bg-surface-2 hover:text-ink')}
      {...rest}
    >
      <Icon size={19} />
    </button>
  );
}

export function ToolPalette({ controller, readOnly }) {
  const tool = useEditorStore((s) => s.tool);
  const [lastShape, setLastShape] = useState('rect');
  const [flyout, setFlyout] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setFlyout(false), flyout);
  const set = (t) => controller?.setTool(t);
  const shapeActive = SHAPE_TOOLS.includes(tool);
  const current = shapeActive ? tool : lastShape;

  return (
    <nav aria-label="Tools" className="pointer-events-auto absolute left-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1 rounded-2xl bg-surface p-1.5 shadow-pop">
      <ToolButton label="Select" shortcut="V" icon={MousePointer2} active={tool === 'select'} onClick={() => set('select')} />
      <ToolButton label="Hand (pan)" shortcut="H or hold Space" icon={Hand} active={tool === 'hand'} onClick={() => set('hand')} />
      {!readOnly && (
        <>
          <div className="mx-2 my-1 h-px bg-line" />
          <ToolButton label="Pen" shortcut="P" icon={Pencil} active={tool === 'pen'} onClick={() => set('pen')} />
          <div ref={ref} className="relative">
            <ToolButton
              label="Shapes"
              icon={shapeActive || flyout ? SHAPES[current].icon : Shapes}
              active={shapeActive}
              aria-expanded={flyout}
              onClick={() => (shapeActive ? setFlyout((o) => !o) : (set(lastShape), setFlyout(true)))}
            />
            {flyout && (
              <div role="menu" className="anim-pop absolute left-[calc(100%+10px)] top-0 flex gap-1 rounded-2xl bg-surface p-1.5 shadow-pop">
                {SHAPE_TOOLS.map((id) => {
                  const s = SHAPES[id];
                  return (
                    <ToolButton
                      key={id}
                      label={s.label}
                      shortcut={s.key}
                      icon={s.icon}
                      active={tool === id}
                      onClick={() => { setLastShape(id); set(id); setFlyout(false); }}
                    />
                  );
                })}
              </div>
            )}
          </div>
          <ToolButton label="Text" shortcut="T" icon={Type} active={tool === 'text'} onClick={() => set('text')} />
          <ToolButton label="Sticky note" shortcut="N" icon={StickyNote} active={tool === 'sticky'} onClick={() => set('sticky')} />
        </>
      )}
    </nav>
  );
}
