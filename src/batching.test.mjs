import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StaticBatch } from './batching.mjs';

const box = (mat, name) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  m.name = name;
  return m;
};

/** Visible à l'écran : lui et tous ses parents. */
const shown = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };

test('les objets de même apparence sont fusionnés et cachés', () => {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const a = box(mat, 'a'), b = box(mat, 'b');
  root.add(a, b);
  const batch = new StaticBatch(root);
  assert.equal(batch.merge(), 2);
  assert.equal(a.visible, false);
  batch.unmerge();
  assert.equal(a.visible, true);
});

test('un objet qui porte un ouvrant reste visible, sa porte aussi (issue 9)', () => {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const host = box(mat, 'Mesh_door'), w1 = box(mat, 'w1'), w2 = box(mat, 'w2');
  const pivot = new THREE.Group();
  pivot.userData.owlnestPartId = 'part_1';
  const leaf = box(mat, 'leaf');
  leaf.userData.owlnestPartId = 'part_1';
  pivot.add(leaf);
  host.add(pivot);
  root.add(host, w1, w2);
  assert.equal(new StaticBatch(root).merge(), 2);
  assert.ok(shown(leaf), 'le vantail doit rester visible');
  assert.equal(w1.visible, false);
});

test('une maille seule de son espèce, sous un objet fusionnable, ne disparaît pas', () => {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const parent = box(mat, 'parent'), other = box(mat, 'other'), third = box(mat, 'third');
  const child = box(new THREE.MeshStandardMaterial({ color: 0xff0000 }), 'child');
  parent.add(child);
  root.add(parent, other, third);
  assert.equal(new StaticBatch(root).merge(), 2);
  assert.ok(shown(child));
});

test('une maille marquée owlnestLive n’est pas fusionnée', () => {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const live = box(mat, 'radiator'), a = box(mat, 'a'), b = box(mat, 'b');
  live.userData.owlnestLive = true;
  root.add(live, a, b);
  assert.equal(new StaticBatch(root).merge(), 2);
  assert.equal(live.visible, true, 'la maille live reste visible et hors batch');
  assert.equal(a.visible, false);
});
