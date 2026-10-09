import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlan, leafName } from './build.mjs';

const plan = (extra = {}) => ({
  version: 1, wallHeight: 2.5, wallThickness: 0.2,
  rooms: [{ id: 'a', name: 'Salon', x: 0, y: 0, w: 4, d: 3 }],
  openings: [],
  ...extra,
});

const boxOf = (o) => new THREE.Box3().setFromObject(o);

test('une pièce : un sol et des murs à la bonne hauteur', () => {
  const root = buildPlan(plan());
  const floor = root.getObjectByName('room_a');
  assert.ok(floor);
  const walls = root.children.filter((c) => c.name.startsWith('wall_'));
  assert.equal(walls.length, 4);
  assert.ok(Math.abs(boxOf(root).max.y - 2.5) < 0.01);
});

test('un muret garde sa propre hauteur', () => {
  const root = buildPlan(plan({ walls: { 'x:0.000:0.000': { height: 1.1 } } }));
  const low = root.children.filter((c) => c.name.startsWith('wall_') && boxOf(c).max.y < 1.2);
  assert.equal(low.length, 1);
});

test('une porte : le mur est ouvert, et le vantail porte ses gonds', () => {
  const root = buildPlan(plan({
    openings: [{ id: 'd', kind: 'door', x: 2, y: 3, width: 0.9, height: 2, sill: 0, hinge: 'end', swing: 'back' }],
  }));
  // Le mur du bas est coupé en trois : avant, linteau, après.
  const bottom = root.children.filter((c) => c.name.startsWith('wall_') && Math.abs(boxOf(c).getCenter(new THREE.Vector3()).z - 3) < 0.01);
  assert.equal(bottom.length, 3);
  const leaf = root.getObjectByName(leafName('d', 1));
  assert.equal(leaf.userData.owlnestLeaf.hinge, 'end');
  assert.equal(leaf.userData.owlnestLeaf.motion, 'hinge');
});

test('une ouverture qui ne tient sur aucun mur est ignorée sans casser le reste', () => {
  const root = buildPlan(plan({
    openings: [{ id: 'x', kind: 'window', x: 10, y: 10, width: 1, height: 1, sill: 1, hinge: 'start', swing: 'front' }],
  }));
  assert.equal(root.getObjectByName(leafName('x', 1)), undefined);
  assert.equal(root.children.filter((c) => c.name.startsWith('wall_')).length, 4);
});

test('une baie coulissante : un panneau fixe, un panneau mobile', () => {
  const root = buildPlan(plan({
    openings: [{ id: 's', kind: 'slider', x: 2, y: 0, width: 2, height: 2.1, sill: 0, hinge: 'start', swing: 'front' }],
  }));
  assert.equal(root.getObjectByName(leafName('s', 1)).userData.owlnestLeaf, undefined);
  assert.equal(root.getObjectByName(leafName('s', 2)).userData.owlnestLeaf.motion, 'rail');
});
