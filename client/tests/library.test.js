import assert from 'node:assert/strict';
import test from 'node:test';
import { searchItems } from '../src/canvas/library/search.js';
import { SHAPES } from '../src/canvas/library/shapes.js';
import { elementToPath, iconNodeToPath, svgToPath } from '../src/canvas/library/svgPath.js';

test('Lucide elements become path data', () => {
  assert.equal(elementToPath(['path', { d: 'M1 2L3 4' }]), 'M1 2L3 4');
  assert.equal(elementToPath(['line', { x1: 1, y1: 2, x2: 3, y2: 4 }]), 'M1 2L3 4');
  assert.equal(elementToPath(['circle', { cx: 12, cy: 12, r: 5 }]), 'M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z');
  assert.equal(elementToPath(['ellipse', { cx: 10, cy: 5, rx: 4, ry: 2 }]), 'M6 5a4 2 0 1 0 8 0a4 2 0 1 0 -8 0z');
  assert.equal(elementToPath(['polyline', { points: '1,2 3,4 5,6' }]), 'M1 2L3 4L5 6');
  assert.equal(elementToPath(['polygon', { points: '0 0 10 0 10 10' }]), 'M0 0L10 0L10 10z');
  assert.equal(elementToPath(['rect', { x: 2, y: 3, width: 10, height: 6 }]), 'M2 3H12V9H2z');
  assert.equal(elementToPath(['unknown', {}]), '');
  assert.equal(elementToPath(['polyline', { points: 'garbage' }]), '');
});

test('rect corners: one radius is copied to the other, and radii are capped at half the side', () => {
  assert.equal(elementToPath(['rect', { x: 0, y: 0, width: 20, height: 10, rx: 2 }]), 'M2 0H18A2 2 0 0 1 20 2V8A2 2 0 0 1 18 10H2A2 2 0 0 1 0 8V2A2 2 0 0 1 2 0z');
  assert.match(elementToPath(['rect', { x: 0, y: 0, width: 10, height: 4, rx: 50 }]), /A5 2 /, 'capped to half of width and half of height');
});

test('a whole icon joins its elements, skipping unknown ones', () => {
  const node = [['path', { d: 'M0 0L1 1' }], ['circle', { cx: 5, cy: 5, r: 1 }], ['mystery', {}]];
  assert.equal(iconNodeToPath(node), 'M0 0L1 1 M4 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0z');
});

test('a Simple Icons file yields its path', () => {
  assert.equal(svgToPath('<svg role="img" viewBox="0 0 24 24"><title>X</title><path d="M0 0h24v24H0z"/></svg>'), 'M0 0h24v24H0z');
  assert.equal(svgToPath('<svg></svg>'), '');
});

test('every built-in shape has a name, tags, a size and a well-formed path with a unique id', () => {
  const ids = new Set();
  for (const s of SHAPES) {
    assert.ok(!ids.has(s.id), `duplicate ${s.id}`);
    ids.add(s.id);
    assert.ok(s.name && s.tags.length && s.w > 0 && s.h > 0, s.id);
    assert.match(s.d, /^M[\d\s.,\-MLHVACQZ]+$/i, `${s.id}: unexpected characters in path`);
    assert.ok(!/NaN|undefined/.test(s.d), s.id);
    // every number must lie inside the shape's own box (with a little room for curve control points)
    const nums = s.d.match(/-?\d+(\.\d+)?/g).map(Number);
    assert.ok(nums.every((n) => n >= -1 && n <= Math.max(s.w, s.h) + 1), `${s.id}: coordinate outside its box`);
  }
  assert.ok(SHAPES.length >= 30);
});

const item = (name, extra = {}) => ({ name, ...extra });
const catalog = [
  item('Facebook', { slug: 'facebook', kind: 'logo' }),
  item('Instagram', { slug: 'instagram' }),
  item('React', { slug: 'react' }),
  item('React Router', { slug: 'reactrouter' }),
  item('Tailwind CSS', { slug: 'tailwindcss' }),
  item('Node.js', { slug: 'nodedotjs' }),
  item('Laptop', { slug: 'laptop', tags: ['computer', 'screen'] }),
  item('Monitor', { slug: 'monitor', tags: ['computer', 'display', 'screen'] }),
  item('Server', { slug: 'server', tags: ['computer', 'cloud', 'rack'] }),
  item('Router', { slug: 'router', tags: ['wifi', 'network'] }),
  item('Hard Drive', { slug: 'hard-drive', tags: ['storage', 'disk'] }),
  item('Database', { slug: 'database', tags: ['storage', 'data'] }),
  item('Github', { slug: 'github' }),
  item('Gitlab', { slug: 'gitlab' }),
  item('.ENV', { slug: 'dotenv', aka: ['Dotenv'] }),
];
const names = (q) => searchItems(catalog, q).map((i) => i.name);

test('the examples people actually type find the right thing first', () => {
  assert.equal(names('fb')[0], 'Facebook');
  assert.equal(names('insta')[0], 'Instagram');
  assert.equal(names('react')[0], 'React', 'exact name beats a longer name that contains it');
  assert.ok(names('react').includes('React Router'));
  assert.equal(names('tailwind')[0], 'Tailwind CSS');
  assert.equal(names('node')[0], 'Node.js');
  assert.equal(names('nodejs')[0], 'Node.js');
  assert.equal(names('laptop')[0], 'Laptop');
  assert.equal(names('server')[0], 'Server');
  assert.equal(names('router')[0], 'Router');
  assert.ok(names('pc').slice(0, 3).every((n) => ['Monitor', 'Laptop', 'Server'].includes(n)), 'pc finds computers: ' + names('pc'));
  assert.equal(names('db')[0], 'Database');
  assert.ok(names('disk').includes('Hard Drive'), 'matches tags');
  assert.equal(names('dotenv')[0], '.ENV', 'matches alternative names');
});

test('search ignores case and punctuation, needs every word, and finds nothing for nonsense', () => {
  assert.equal(names('  FACE-book ')[0], 'Facebook');
  assert.deepEqual(names('tailwind css'), ['Tailwind CSS']);
  assert.deepEqual(names('tailwind react'), []);
  assert.deepEqual(names('zzzzqq'), []);
  assert.equal(searchItems(catalog, '').length, catalog.length, 'empty query returns everything (capped by limit)');
  assert.equal(searchItems(catalog, '', { limit: 3 }).length, 3);
});

test('a short word only matches where a word starts, not in the middle of any name', () => {
  assert.deepEqual(names('ac'), [], '"ac" must not match "Facebook"');
  assert.ok(names('book').includes('Facebook'), 'but 3+ letters may match inside a name');
});
