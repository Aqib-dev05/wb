import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardState, OP } from '../src/services/boardState.js';
import { PATCH_KEYS, submitSchema } from '../src/validators/ops.validators.js';
import { BOARD, batch, create, rect } from './helpers/harness.js';

const ids = (s) => s.order.join(',');

test('create is idempotent: an existing id is ignored', () => {
  const s = new BoardState([rect('a')]);
  const { accepted, rejected } = s.plan([create('a'), create('b')]);
  assert.equal(accepted.length, 1);
  assert.deepEqual(rejected, [{ index: 0, reason: 'exists' }]);
});

test('updates merge per property; the later update wins on the same property only', () => {
  const s = new BoardState([rect('a', { left: 1, fill: 'red' })]);
  s.apply({ type: OP.UPDATED, id: 'a', patch: { left: 50 } }); // user 1 moves
  s.apply({ type: OP.UPDATED, id: 'a', patch: { fill: 'blue', left: 70 } }); // user 2 recolors and moves
  assert.equal(s.map.get('a').fill, 'blue');
  assert.equal(s.map.get('a').left, 70); // later wins
  assert.equal(s.map.get('a').top, 0); // untouched property preserved
});

test('delete wins: updates to a deleted object are rejected, deletes are idempotent', () => {
  const s = new BoardState([rect('a')]);
  s.apply({ type: OP.DELETED, id: 'a' });
  const { accepted, rejected } = s.plan([{ type: OP.UPDATED, id: 'a', patch: { left: 1 } }, { type: OP.DELETED, id: 'a' }]);
  assert.equal(accepted.length, 0);
  assert.deepEqual(rejected.map((r) => r.reason), ['gone', 'gone']);
});

test('a batch may create then update the same object', () => {
  const s = new BoardState();
  const { accepted } = s.plan([create('a'), { type: OP.UPDATED, id: 'a', patch: { left: 5 } }]);
  assert.equal(accepted.length, 2);
});

test('ordering: afterId undefined = top, null = bottom, id = directly above, missing anchor = top', () => {
  const s = new BoardState([rect('a'), rect('b'), rect('c')]);
  s.apply({ ...create('top') });
  s.apply(create('bottom', {}, null));
  s.apply(create('mid', {}, 'a'));
  s.apply(create('orphan', {}, 'does-not-exist'));
  assert.equal(ids(s), 'bottom,a,mid,b,c,top,orphan');
  s.apply({ type: OP.REORDERED, id: 'c', afterId: null });
  s.apply({ type: OP.REORDERED, id: 'a', afterId: 'b' });
  assert.equal(ids(s), 'c,bottom,mid,b,a,top,orphan');
});

test('validator strips unknown keys and rejects unsafe or malformed input', () => {
  const parse = (ops) => submitSchema.safeParse(batch(ops, BOARD));
  const stripped = parse([{ type: 'object:created', object: { ...rect('a'), onclick: 'x', clipPath: { type: 'Image', src: 'http://evil' } } }]);
  assert.equal(stripped.success, true);
  assert.equal('clipPath' in stripped.data.ops[0].object, false);
  assert.equal(parse([{ type: 'object:created', object: { id: 'a', type: 'Image', src: 'http://evil' } }]).success, false, 'unknown object type');
  assert.equal(parse([{ type: 'object:updated', id: 'a', patch: { type: 'Image' } }]).success, false, 'type/id are not patchable');
  assert.equal(parse([{ type: 'object:updated', id: 'a', patch: {} }]).success, false, 'empty patch');
  assert.equal(parse([{ type: 'object:updated', id: 'a', patch: { left: Infinity } }]).success, false, 'non-finite number');
  assert.equal(parse([{ type: 'object:created', object: { ...rect('a'), shadow: { $where: 1 } } }]).success, false, 'mongo operator key');
  assert.equal(parse([{ type: 'object:created', object: { ...rect('a'), text: 'x'.repeat(30000) } }]).success, false, 'oversized string');
  assert.equal(submitSchema.safeParse(batch(Array.from({ length: 501 }, (_, i) => ({ type: 'object:deleted', id: `d${i}` })), BOARD)).success, false, 'batch too large');
  assert.ok(PATCH_KEYS.has('left') && !PATCH_KEYS.has('type') && !PATCH_KEYS.has('id'));
});
