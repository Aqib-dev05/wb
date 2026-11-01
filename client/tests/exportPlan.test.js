import assert from 'node:assert/strict';
import test from 'node:test';
import { fileSlug, MAX_PIXELS, MAX_SIDE, planExport } from '../src/canvas/exportPlan.js';

test('a small board is exported at the requested scale with padding around the content', () => {
  const p = planExport({ left: 100, top: 50, width: 300, height: 200 }, { scale: 2, padding: 40 });
  assert.deepEqual([p.left, p.top, p.width, p.height], [60, 10, 380, 280]);
  assert.equal(p.multiplier, 2);
  assert.deepEqual([p.pxWidth, p.pxHeight], [760, 560]);
  assert.equal(p.clamped, false);
});

test('fractional bounds round the crop outwards so nothing is cut off', () => {
  const p = planExport({ left: 10.4, top: 20.6, width: 100.2, height: 50.1 }, { scale: 1, padding: 10 });
  assert.equal(p.left, 0); // floor(0.4)
  assert.equal(p.top, 10); // floor(10.6)
  assert.equal(p.width, 121); // ceil(120.2)
  assert.equal(p.height, 71); // ceil(70.1)
  assert.ok(p.left <= 10.4 - 10 && p.left + p.width >= 10.4 + 100.2 + 10);
});

test('a very wide board is scaled down to the side limit and reported as clamped', () => {
  const p = planExport({ left: 0, top: 0, width: 20000, height: 100 }, { scale: 2, padding: 0 });
  assert.ok(p.clamped);
  assert.ok(p.pxWidth <= MAX_SIDE && p.pxHeight <= MAX_SIDE);
  assert.equal(p.pxWidth, MAX_SIDE);
});

test('a big square board is limited by total pixels (iOS Safari canvas limit)', () => {
  const p = planExport({ left: 0, top: 0, width: 6000, height: 6000 }, { scale: 2, padding: 0 });
  assert.ok(p.clamped);
  assert.ok(p.pxWidth * p.pxHeight <= MAX_PIXELS * 1.001);
});

test('a board that fits at 1x is not clamped when 1x is requested, even if 2x would not fit', () => {
  const b = { left: 0, top: 0, width: 3000, height: 3000 }; // 9M px at 1x, 36M at 2x
  assert.equal(planExport(b, { scale: 1, padding: 0 }).clamped, false);
  assert.equal(planExport(b, { scale: 2, padding: 0 }).clamped, true);
});

test('fileSlug makes safe file names', () => {
  assert.equal(fileSlug('My Board / v2?'), 'my-board-v2');
  assert.equal(fileSlug('Café Plan'), 'cafe-plan');
  assert.equal(fileSlug('   '), 'board');
  assert.equal(fileSlug('../../etc/passwd'), 'etc-passwd');
  assert.ok(fileSlug('x'.repeat(200)).length <= 60);
});
