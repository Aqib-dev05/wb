import { SHAPES } from './shapes.js';
import { iconNodeToPath, svgToPath } from './svgPath.js';

// The three sources of library items. Icons and logos are large, so they are only fetched when the
// library is opened (separate chunks), and a logo's outline is fetched when it is shown or placed.
//   shapes: ./shapes.js (built in)          icons: Lucide (ISC)          logos: Simple Icons (CC0)
// Logos are trademarks of their owners; the panel says so.

export { SHAPES };

const titleCase = (slug) => slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

let iconsPromise = null;
export function loadIcons() {
  iconsPromise ??= Promise.all([import('lucide-static/icon-nodes.json'), import('lucide-static/tags.json')]).then(([nodes, tags]) =>
    Object.entries(nodes.default).map(([slug, node]) => ({
      id: `icon:${slug}`,
      kind: 'icon',
      name: titleCase(slug),
      slug,
      tags: tags.default[slug] ?? [],
      d: iconNodeToPath(node),
      w: 24,
      h: 24,
    }))
  );
  iconsPromise.catch(() => { iconsPromise = null; }); // allow a retry after a network failure
  return iconsPromise;
}

let logosPromise = null;
export function loadLogos() {
  logosPromise ??= import('simple-icons/icons.json').then((m) =>
    m.default.map((i) => ({ id: `logo:${i.slug}`, kind: 'logo', name: i.title, slug: i.slug, hex: i.hex, aka: i.aliases?.aka ?? [], w: 24, h: 24 }))
  );
  logosPromise.catch(() => { logosPromise = null; });
  return logosPromise;
}

const svgFiles = import.meta.glob('/node_modules/simple-icons/icons/*.svg', { query: '?raw', import: 'default' });
const logoPaths = new Map();

/** Outline of one logo (cached). */
export function logoPath(slug) {
  if (!logoPaths.has(slug)) {
    const load = svgFiles[`/node_modules/simple-icons/icons/${slug}.svg`];
    logoPaths.set(slug, load ? load().then(svgToPath) : Promise.reject(new Error(`No logo "${slug}"`)));
    logoPaths.get(slug).catch(() => logoPaths.delete(slug));
  }
  return logoPaths.get(slug);
}

// What is shown before anyone types: the things people draw architecture and product diagrams with.
export const POPULAR_ICONS = ['laptop', 'monitor', 'server', 'router', 'database', 'cloud', 'smartphone', 'tablet', 'wifi', 'cpu', 'hard-drive', 'globe', 'lock', 'shield', 'code', 'terminal', 'git-branch', 'user', 'users', 'mail', 'settings', 'bell', 'search', 'zap'];
export const POPULAR_LOGOS = ['react', 'tailwindcss', 'nodedotjs', 'mongodb', 'docker', 'github', 'facebook', 'instagram', 'x', 'youtube', 'whatsapp', 'google', 'figma', 'vite', 'javascript', 'typescript', 'python', 'express', 'postgresql', 'git', 'linux', 'apple', 'vuedotjs', 'redis'];

/** Pins `slugs` to the front, in that order. */
export function pinned(items, slugs) {
  const by = new Map(items.map((i) => [i.slug, i]));
  return slugs.map((s) => by.get(s)).filter(Boolean);
}
