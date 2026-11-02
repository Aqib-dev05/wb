export const TOOLS = ['select', 'hand', 'pen', 'rect', 'ellipse', 'triangle', 'line', 'arrow', 'text', 'sticky'];
export const SHAPE_TOOLS = ['rect', 'ellipse', 'triangle', 'line', 'arrow'];

// Custom properties Fabric must serialize/clone in addition to its own.
export const PROPS = ['id', 'kind', 'text', 'fontSize', 'textColor'];

export const FONT = 'Onest, ui-sans-serif, system-ui, sans-serif';
export const PAPER = '#FAFBFE'; // the board surface stays light in both UI themes
export const GRID_SIZE = 24;
export const ZOOM = { min: 0.1, max: 8, step: 1.25 };

export const DEFAULTS = { fill: '#FFFFFF', stroke: '#14161F', strokeWidth: 2, opacity: 1, fontSize: 24 };

export const PALETTE = ['#14161F', '#6B7084', '#FFFFFF', '#5B4BFF', '#2E9BFF', '#2FCB8E', '#FFD84D', '#F5A524', '#FF6B57', '#E0489B'];
export const STICKY_COLORS = ['#FFD84D', '#B9F0D8', '#FFD0C9', '#C9C2FF', '#B9E3FF', '#FFFFFF'];

// Which style properties each object kind supports.
export const CAPS = {
  rect: { fill: 'Fill', stroke: 'Stroke', strokeWidth: true, opacity: true },
  ellipse: { fill: 'Fill', stroke: 'Stroke', strokeWidth: true, opacity: true },
  triangle: { fill: 'Fill', stroke: 'Stroke', strokeWidth: true, opacity: true },
  line: { stroke: 'Stroke', strokeWidth: true, opacity: true },
  arrow: { stroke: 'Stroke', strokeWidth: true, opacity: true },
  pen: { stroke: 'Stroke', strokeWidth: true, opacity: true },
  text: { fill: 'Text color', fontSize: true, opacity: true },
  sticky: { fill: 'Note color', fontSize: true, opacity: true },
  // Library items (all are Paths). Icons are line art; logos are one solid colour; shapes have both.
  shape: { fill: 'Fill', stroke: 'Stroke', strokeWidth: true, opacity: true },
  icon: { stroke: 'Stroke', strokeWidth: true, opacity: true },
  logo: { fill: 'Color', opacity: true },
};

// Style controls shown for a tool before anything is selected (they edit the defaults for new objects).
export const TOOL_CAPS = {
  select: CAPS.rect,
  hand: CAPS.rect,
  pen: CAPS.pen,
  rect: CAPS.rect,
  ellipse: CAPS.ellipse,
  triangle: CAPS.triangle,
  line: CAPS.line,
  arrow: CAPS.arrow,
  text: { stroke: 'Text color', fontSize: true, opacity: true },
  sticky: null,
};
