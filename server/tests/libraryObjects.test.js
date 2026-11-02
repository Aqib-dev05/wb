import test from 'node:test';
import assert from 'node:assert/strict';
import { submitSchema } from '../src/validators/ops.validators.js';

const boardId = 'a'.repeat(24);
const submit = (object) => submitSchema.safeParse({ boardId, batchId: 'b1', ops: [{ type: 'object:created', object }] });

// What the client's insertLibraryItem produces (Fabric 7 Path.toObject plus our `kind`).
const libraryPath = (kind, commands = 40) => ({
  id: 'o1', type: 'Path', kind, version: '7.0.0', originX: 'left', originY: 'top',
  left: 10.5, top: 20, width: 24, height: 24, fill: kind === 'icon' ? null : '#1877F2', stroke: kind === 'icon' ? '#14161F' : null,
  strokeWidth: 4, strokeUniform: true, strokeLineCap: 'round', strokeLineJoin: 'round', fillRule: 'evenodd',
  scaleX: 4, scaleY: 4, opacity: 1, pathOffset: { x: 12, y: 12 },
  path: Array.from({ length: commands }, (_, i) => (i === 0 ? ['M', 1, 2] : ['C', i, i, i + 1, i + 1, i + 2, i + 2])),
});

for (const kind of ['shape', 'icon', 'logo']) {
  test(`library ${kind} object passes validation unchanged`, () => {
    const input = libraryPath(kind);
    const r = submit(input);
    assert.ok(r.success, r.error?.message);
    const out = r.data.ops[0].object;
    assert.equal(out.kind, kind);
    assert.equal(out.fillRule, 'evenodd');
    assert.deepEqual(out.path, input.path);
    assert.deepEqual(out.pathOffset, input.pathOffset);
  });
}

test('a very detailed logo (2,000 curves) is accepted, an absurd one is rejected', () => {
  assert.ok(submit(libraryPath('logo', 2000)).success);
  assert.equal(submit(libraryPath('logo', 20000)).success, false);
});

test('unknown kind values are still just strings, unknown keys are stripped', () => {
  const r = submit({ ...libraryPath('logo'), evil: 'x' });
  assert.ok(r.success);
  assert.equal('evil' in r.data.ops[0].object, false);
});
