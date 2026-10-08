import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateLighten, estimateGeometry, worthOffering } from './lighten.mjs';

test("rien à alléger : l'option ne se propose pas", () => {
  const e = estimateLighten([{ width: 1024, height: 512, bytes: 100 }, { width: 256, height: 256, bytes: 10 }]);
  assert.deepEqual(e, { heavy: 0, before: 110, after: 110 });
});

test('le gain suit le nombre de pixels', () => {
  // 4096 px réduit à 1024 : seize fois moins de pixels.
  const e = estimateLighten([{ width: 4096, height: 2048, bytes: 1600 }, { width: 512, height: 512, bytes: 50 }]);
  assert.equal(e.heavy, 1);
  assert.equal(e.before, 1650);
  assert.equal(e.after, 150);
});

test("on compte les triangles par groupe, et on épargne la maison et ses ouvrants", () => {
  const faces = (n, corners = 3) => Array.from({ length: n }, () => 'f ' + Array.from({ length: corners }, (_, i) => i + 1).join(' ')).join('\n');
  const obj = [
    'g wall_1_2', faces(3000),
    'g sweethome3d_opening_on_hinge_1_door', faces(2000),
    'g Kitchenware_110_766', faces(1000, 4),
    'g lamp', faces(100),
  ].join('\n');
  const e = estimateGeometry(obj);
  assert.equal(e.before, 3000 + 2000 + 2000 + 100);
  assert.equal(e.dense, 2000, 'seule la vaisselle est simplifiable');
  assert.equal(e.after, e.before - 1500);
});

test("on ne propose rien pour un plan léger aux textures raisonnables", () => {
  const textures = { heavy: 0, before: 0, after: 0 };
  assert.equal(worthOffering({ textures, geometry: { before: 100_000, dense: 50_000, after: 60_000 } }), false);
  assert.equal(worthOffering({ textures, geometry: { before: 900_000, dense: 700_000, after: 380_000 } }), true);
  assert.equal(worthOffering({ textures: { heavy: 2, before: 9, after: 3 }, geometry: { before: 10, dense: 0, after: 10 } }), true);
});
