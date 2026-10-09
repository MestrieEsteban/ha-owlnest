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

test('une armoire adossée et l’objet posé dessus disparaissent avec leur mur, pas le canapé', () => {
  const { plan, root, lw } = setup();
  // Armoire contre le mur sud (dos au sud, l'avant vers le nord : rotation 180).
  plan.items = [
    { id: 'w', model: 'x', x: 3, y: 4 - 0.075 - 0.3, rotation: 180, size: [1.2, 0.6, 2] },
    { id: 'v', model: 'y', x: 3, y: 4 - 0.075 - 0.3, rotation: 0, size: [0.2, 0.2, 0.3], elevation: undefined },
    { id: 's', model: 'z', x: 1.5, y: 4 - 0.075 - 0.45, rotation: 180, size: [2, 0.9, 0.8] },
  ];
  for (const it of plan.items) { const g = new THREE.Group(); g.name = `plan_item_${it.id}`; root.add(g); }
  lw.attachItems(plan, root);
  const ids = lw.attached.map((a) => a.holder.name).sort();
  assert.deepEqual(ids, ['plan_item_v', 'plan_item_w']);
  const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 6, 10);
  settle(lw, cam, root);
  assert.equal(root.getObjectByName('plan_item_w').visible, false);
  assert.equal(root.getObjectByName('plan_item_s').visible, true);
});
