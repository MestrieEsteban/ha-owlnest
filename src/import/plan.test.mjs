import test from 'node:test';
import assert from 'node:assert/strict';
import { planImport, modelSlug } from './plan.mjs';

const enc = (s) => new TextEncoder().encode(s);
const f = (path, s = 'x') => ({ path, data: typeof s === 'string' ? enc(s) : s });

test('rien de déposé', () => {
  assert.deepEqual(planImport([]), { kind: 'error', reason: 'empty' });
});

test('un GLB passe avant tout le reste', () => {
  const plan = planImport([f('maison/plan.obj', 'v 0 0 0'), f('maison/Plan Final.glb', 'glTF....')]);
  assert.equal(plan.kind, 'glb');
  assert.equal(plan.name, 'plan final');
});

test("un export Sweet Home 3D : l'OBJ, le MTL qu'il cite, ses images", () => {
  const plan = planImport([
    f('export/autre.mtl', 'newmtl a'),
    f('export/maison.obj', 'mtllib cite.mtl\nv 0 0 0'),
    f('export/cite.mtl', 'newmtl b'),
    f('export/Bois.JPG'),
    f('export/sol.png'),
    f('export/lisez-moi.txt'),
  ]);
  assert.equal(plan.kind, 'obj');
  assert.equal(plan.name, 'maison');
  assert.equal(new TextDecoder().decode(plan.mtl), 'newmtl b');
  assert.deepEqual([...plan.images.keys()].sort(), ['bois.jpg', 'sol.png']);
  assert.equal(plan.images.get('sol.png').mime, 'image/png');
});

test('sans mtllib, le MTL du même nom', () => {
  const plan = planImport([f('a.mtl', 'A'), f('maison.obj', 'v 0 0 0'), f('maison.mtl', 'M')]);
  assert.equal(new TextDecoder().decode(plan.mtl), 'M');
});

test("l'OBJ le plus lourd l'emporte sur un brouillon", () => {
  const plan = planImport([f('essai.obj', 'v'), f('final.obj', 'v 1 2 3\nv 4 5 6')]);
  assert.equal(plan.name, 'final');
});

test('un .gltf seul est signalé, pas ignoré', () => {
  assert.deepEqual(planImport([f('scene.gltf'), f('scene.bin')]), { kind: 'error', reason: 'gltf-text' });
  assert.deepEqual(planImport([f('photo.jpg')]), { kind: 'error', reason: 'no-model' });
});

test('le nom du modèle est sûr et horodaté', () => {
  const at = new Date('2026-10-08T09:05:03Z');
  assert.equal(modelSlug('Maison de Léa (v2)', at), 'maison-de-lea-v2-20261008090503');
  assert.equal(modelSlug('???', at), 'maison-20261008090503');
  assert.match(modelSlug('x'.repeat(200), at), /^[a-z0-9][a-z0-9_-]{0,63}$/);
});
