import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StaticBatch } from './batching.mjs';

const material = new THREE.MeshStandardMaterial({ color: 0xffffff });

function box(name, x = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  m.name = name;
  m.position.x = x;
  return m;
}

/** Visible à l'écran : lui et toute sa lignée. */
function shown(o) {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

test('les objets immobiles de même apparence sont fusionnés', () => {
  const root = new THREE.Group();
  const a = box('a', 0);
  const b = box('b', 2);
  root.add(a, b);
  const batch = new StaticBatch(root);

  assert.equal(batch.merge(), 2);
  assert.equal(a.visible, false);
  assert.equal(b.visible, false);
  batch.unmerge();
  assert.equal(a.visible, true);
  assert.equal(b.visible, true);
});

test('le cadre qui porte le pivot d\'un ouvrant reste affiché (issue #9)', () => {
  // Le vantail est détaché du cadre puis monté sous un pivot, enfant du cadre.
  const root = new THREE.Group();
  const frame = box('Mesh_door', 0);
  const wall = box('wall', 2);
  const other = box('other', 4);
  const pivot = new THREE.Group();
  pivot.userData.owlnestPartId = 'part_1';
  const leaf = box('leaf', 0);
  leaf.userData.owlnestPartId = 'part_1';
  pivot.add(leaf);
  frame.add(pivot);
  root.add(frame, wall, other);

  const batch = new StaticBatch(root);
  assert.equal(batch.merge(), 2, 'seuls les objets sans enfants sont fusionnés');
  assert.ok(shown(frame), 'le cadre reste visible');
  assert.ok(shown(leaf), 'le vantail reste visible');
  assert.equal(wall.visible, false);
});
