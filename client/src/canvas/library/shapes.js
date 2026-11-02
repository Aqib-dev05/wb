// Built-in shapes. `d` is drawn in a w x h box. `fill: false` marks line-art (check, cross) that has
// no inside. Flowchart pieces, arrows, callouts and a few common diagram symbols.

const S = (id, name, tags, w, h, d, extra = {}) => ({ id: `shape:${id}`, kind: 'shape', name, tags, w, h, d, fill: true, ...extra });

export const SHAPES = [
  S('rounded-rect', 'Rounded rectangle', ['box', 'card', 'process', 'flowchart'], 120, 80, 'M12 0H108A12 12 0 0 1 120 12V68A12 12 0 0 1 108 80H12A12 12 0 0 1 0 68V12A12 12 0 0 1 12 0Z'),
  S('pill', 'Terminator', ['pill', 'start', 'end', 'flowchart', 'stadium'], 120, 50, 'M25 0H95A25 25 0 0 1 95 50H25A25 25 0 0 1 25 0Z'),
  S('diamond', 'Diamond', ['decision', 'rhombus', 'flowchart', 'condition'], 100, 100, 'M50 0L100 50L50 100L0 50Z'),
  S('parallelogram', 'Parallelogram', ['data', 'input', 'output', 'flowchart'], 120, 60, 'M24 0H120L96 60H0Z'),
  S('trapezoid', 'Trapezoid', ['manual', 'operation', 'flowchart'], 120, 60, 'M24 0H96L120 60H0Z'),
  S('right-triangle', 'Right triangle', ['triangle', 'wedge'], 100, 100, 'M0 0V100H100Z'),
  S('pentagon', 'Pentagon', ['polygon', 'five'], 100, 100, 'M50 0L100 38L81 100H19L0 38Z'),
  S('hexagon', 'Hexagon', ['polygon', 'six', 'honeycomb', 'prep'], 100, 87, 'M25 0H75L100 43.5L75 87H25L0 43.5Z'),
  S('octagon', 'Octagon', ['polygon', 'eight', 'stop'], 100, 100, 'M30 0H70L100 30V70L70 100H30L0 70V30Z'),
  S('star', 'Star', ['favorite', 'rating', 'five', 'award'], 100, 95, 'M50 0L61.8 35.5L100 36.4L69.5 59.5L80.9 95.5L50 73.7L19.1 95.5L30.5 59.5L0 36.4L38.2 35.5Z'),
  S('sparkle', 'Sparkle', ['star', 'four', 'shine', 'ai', 'magic'], 100, 100, 'M50 0L62 38L100 50L62 62L50 100L38 62L0 50L38 38Z'),
  S('plus', 'Plus', ['cross', 'add', 'medical'], 100, 100, 'M35 0H65V35H100V65H65V100H35V65H0V35H35Z'),
  S('heart', 'Heart', ['love', 'like', 'favorite'], 100, 90, 'M50 90C10 60 0 40 0 25C0 10 12 0 27 0C38 0 46 6 50 15C54 6 62 0 73 0C88 0 100 10 100 25C100 40 90 60 50 90Z'),
  S('lightning', 'Lightning', ['bolt', 'power', 'energy', 'fast'], 60, 100, 'M40 0L0 55H25L15 100L60 40H33Z'),
  S('cloud', 'Cloud', ['cloud', 'network', 'internet', 'storage'], 100, 65, 'M25 65C10 65 0 55 0 42C0 30 9 21 21 20C23 8 34 0 47 0C59 0 69 7 73 18C75 17 77 17 79 17C91 17 100 26 100 38C100 53 90 65 75 65Z'),
  S('speech-bubble', 'Speech bubble', ['comment', 'chat', 'message', 'callout', 'talk'], 100, 80, 'M10 0H90Q100 0 100 10V50Q100 60 90 60H40L20 80L22 60H10Q0 60 0 50V10Q0 0 10 0Z'),
  S('cylinder', 'Cylinder (database)', ['database', 'db', 'storage', 'data', 'disk'], 80, 100, 'M0 15A40 15 0 0 1 80 15V85A40 15 0 0 1 0 85ZM0 15A40 15 0 0 0 80 15'),
  S('document', 'Document', ['file', 'page', 'paper', 'report'], 80, 100, 'M0 0H80V85C60 75 50 100 30 92C20 88 10 86 0 90Z'),
  S('folder', 'Folder', ['directory', 'files'], 100, 80, 'M0 10Q0 0 10 0H35L45 12H90Q100 12 100 22V70Q100 80 90 80H10Q0 80 0 70Z'),
  S('cube', 'Cube', ['3d', 'box', 'package', 'isometric', 'block'], 100, 100, 'M50 0L100 25V75L50 100L0 75V25ZM0 25L50 50L100 25M50 50V100'),
  S('ring', 'Ring', ['donut', 'circle', 'hole', 'loading'], 100, 100, 'M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50ZM25 50A25 25 0 1 0 75 50A25 25 0 1 0 25 50Z', { evenodd: true }),
  S('semicircle', 'Semicircle', ['half', 'arch', 'dome'], 100, 50, 'M0 50A50 50 0 0 1 100 50Z'),
  S('quarter-circle', 'Quarter circle', ['pie', 'quadrant', 'corner'], 100, 100, 'M0 100V0A100 100 0 0 1 100 100Z'),
  S('chevron', 'Chevron', ['process', 'step', 'timeline', 'arrow'], 120, 80, 'M0 0H80L120 40L80 80H0L40 40Z'),
  S('arrow-right', 'Arrow right', ['block', 'next', 'direction'], 100, 70, 'M0 20H60V0L100 35L60 70V50H0Z'),
  S('arrow-left', 'Arrow left', ['block', 'back', 'previous', 'direction'], 100, 70, 'M100 20H40V0L0 35L40 70V50H100Z'),
  S('arrow-up', 'Arrow up', ['block', 'increase', 'direction'], 70, 100, 'M20 100V40H0L35 0L70 40H50V100Z'),
  S('arrow-down', 'Arrow down', ['block', 'decrease', 'direction'], 70, 100, 'M20 0V60H0L35 100L70 60H50V0Z'),
  S('double-arrow', 'Double arrow', ['both', 'bidirectional', 'exchange', 'sync'], 100, 50, 'M0 25L25 0V15H75V0L100 25L75 50V35H25V50Z'),
  S('check', 'Check mark', ['tick', 'done', 'yes', 'ok', 'success'], 100, 80, 'M5 45L35 75L95 5', { fill: false }),
  S('cross', 'Cross mark', ['x', 'no', 'close', 'cancel', 'wrong'], 100, 100, 'M5 5L95 95M95 5L5 95', { fill: false }),
  S('bracket', 'Curly bracket', ['brace', 'group', 'code'], 40, 120, 'M40 0Q15 0 15 25V45Q15 58 0 60Q15 62 15 75V95Q15 120 40 120', { fill: false }),
];
