import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LowWalls } from './low-walls.mjs';
import { addRect } from './graph.mjs';

// Une pièce de 6 m × 4 m ; le centre du plan à l'origine de la scène.
function setup() {
  const plan = { version: 2, wallHeight: 2.5, wallThickness: 0.15, nodes: [], walls: [], rooms: [], openings: [], items: [] };
  addRect(plan, 0, 0, 6, 4);
  const root = new THREE.Group();
  root.position.set(-3, 0, -2);
  root.updateMatrixWorld(true);
  const lw = new LowWalls();
  lw.enabled = true;
  lw.setPlan(plan, root);
  return { plan, root, lw };
}
const wallAt = (plan, test) => plan.walls.findIndex((w) => {
  const a = plan.nodes.find((n) => n.id === w.a), b = plan.nodes.find((n) => n.id === w.b);
  return test(a, b);
});
const settle = (lw, cam, root) => { for (let i = 0; i < 20; i++) lw.update(cam, new THREE.Vector3(0, 0, 0), root, 0.05); };

test('vu du sud, le mur sud descend, le mur nord reste debout', () => {
  const { plan, root, lw } = setup();
  const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 6, 10);
  settle(lw, cam, root);
  const south = wallAt(plan, (a, b) => a.y === 4 && b.y === 4), north = wallAt(plan, (a, b) => a.y === 0 && b.y === 0);
  assert.equal(lw.factor[south], 1);
  assert.equal(lw.factor[north], 0);
});

test('vu d’en haut, aucun mur ne descend ; mode coupé, tout remonte', () => {
  const { root, lw } = setup();
  const cam = new THREE.PerspectiveCamera(); cam.position.set(0.1, 15, 0.1);
  settle(lw, cam, root);
  assert.ok(Array.from(lw.factor.slice(0, 4)).every((f) => f === 0));
  cam.position.set(0, 6, 10); settle(lw, cam, root);
  lw.enabled = false; settle(lw, cam, root);
  assert.ok(Array.from(lw.factor.slice(0, 4)).every((f) => f === 0));
});

test('une étagère accrochée et l’objet posé dessus disparaissent avec leur mur ; l’armoire au sol reste', () => {
  const { plan, root, lw } = setup();
  const back = 4 - 0.075;
  plan.items = [
    // Étagère murale à 1,60 m, contre le mur sud.
    { id: 'shelf', model: 'x', x: 3, y: back - 0.15, rotation: 180, size: [1, 0.3, 0.05], elevation: 1.6 },
    { id: 'vase', model: 'y', x: 3, y: back - 0.15, rotation: 0, size: [0.15, 0.15, 0.3] },
    // Armoire posée au sol contre le même mur : elle reste.
    { id: 'wardrobe', model: 'z', x: 1.2, y: back - 0.3, rotation: 180, size: [1.2, 0.6, 2] },
    // Commode, et lampe posée dessus (au-dessus de la coupe, mais pas accrochée).
    { id: 'chest', model: 'c', x: 4.5, y: back - 0.25, rotation: 180, size: [1, 0.5, 0.8] },
    { id: 'lamp', model: 'l', x: 4.5, y: back - 0.25, rotation: 180, size: [0.3, 0.3, 0.5], elevation: 0.8 },
  ];
  for (const it of plan.items) { const g = new THREE.Group(); g.name = `plan_item_${it.id}`; root.add(g); }
  lw.attachItems(plan, root);
  assert.deepEqual(lw.attached.map((a) => a.holder.name).sort(), ['plan_item_shelf', 'plan_item_vase']);
  const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 6, 10);
  settle(lw, cam, root);
  assert.equal(root.getObjectByName('plan_item_shelf').visible, false);
  assert.equal(root.getObjectByName('plan_item_wardrobe').visible, true);
  assert.equal(root.getObjectByName('plan_item_lamp').visible, true);
});

test('mode fantôme : un voile sur les murs seulement, affiché quand le mode est actif', async () => {
  const { tagWall, wallItemCode, WALL_ATTR } = await import('./low-walls.mjs');
  const { root, lw } = setup();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  tagWall(wall.geometry, 0);
  const sofa = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  sofa.geometry.setAttribute(WALL_ATTR, new THREE.BufferAttribute(new Float32Array(sofa.geometry.getAttribute('position').count).fill(wallItemCode(0)), 1));
  root.add(wall, sofa);
  lw.instrument(root);
  const ghostOf = (m) => m.children.find((c) => c.name === 'owlnest_wall_ghost');
  assert.ok(ghostOf(wall), 'le mur a son voile');
  assert.equal(ghostOf(sofa), undefined, 'un meuble n’en a pas');
  assert.equal(ghostOf(wall).visible, false);
  lw.setGhost(true, root);
  assert.equal(lw.ghost, true);
  assert.equal(ghostOf(wall).visible, true);
  // Un second passage n'ajoute pas de second voile.
  lw.instrument(root);
  assert.equal(wall.children.length, 1);
});
