import test from 'node:test';
import assert from 'node:assert/strict';
import { levelsOf, levelAt, LOW_WALL_RATIO } from './low-walls.mjs';

test("un linteau ou une plinthe ne font pas un étage", () => {
  const levels = levelsOf([
    { base: 0, top: 250 }, { base: 0, top: 250 },
    { base: 210, top: 250 },   // linteau au-dessus d'une porte
    { base: 0, top: 7 },       // plinthe
    { base: 250, top: 250 },   // dessus du mur, plat
  ]);
  assert.deepEqual(levels, [{ base: 0, cut: 250 * LOW_WALL_RATIO }]);
});

test('deux étages, chacun coupé à sa hauteur', () => {
  const levels = levelsOf([{ base: 0, top: 250 }, { base: 262, top: 512 }, { base: 0.5, top: 250 }]);
  assert.equal(levels.length, 2);
  assert.equal(levelAt(levels, 300).base, 262);
  assert.equal(levelAt(levels, 210).base, 0, 'un linteau appartient à son étage');
});
