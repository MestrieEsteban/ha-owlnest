import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PartHighlight } from './part-highlight.mjs';
import { stampOrder } from './model-outline.mjs';

function scene() {
  const root = new THREE.Group();
  const door = new THREE.Group();
  door.name = 'puerta';
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1));
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
  door.add(a, b);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.2));
  root.add(wall, door);
  return { root, door, a, b, wall };
}

test('surligner un groupe teinte chacune de ses mailles, sans copier la géométrie', () => {
  const { door, a, b } = scene();
  const h = new PartHighlight();
  assert.equal(h.show('selected', [{ object: door }]), 2);
  const overlay = a.children[0];
  assert.equal(overlay.geometry, a.geometry, 'géométrie partagée');
  assert.equal(b.children.length, 1);
  assert.equal(overlay.material.depthTest, false, 'visible à travers les murs');
});

test('le surlignage ne touche ni aux matériaux ni aux rangs du modèle', () => {
  const { root, door, a } = scene();
  const material = a.material;
  const h = new PartHighlight();
  h.show('hover', [{ object: door }]);
  assert.equal(a.material, material);
  assert.equal(stampOrder(root).byRank.length, 4, 'les calques n’entrent pas dans l’arborescence');
  const hits = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)).intersectObject(root, true);
  assert.ok(hits.every((x) => !x.object.userData.owlnestHelper), 'les calques ne captent pas les clics');
});

test('clear retire tout, par emplacement ou en bloc', () => {
  const { door, wall, a } = scene();
  const h = new PartHighlight();
  h.show('hover', [{ object: wall }]);
  h.show('selected', [{ object: door }]);
  h.clear('hover');
  assert.equal(wall.children.length, 0);
  assert.equal(a.children.length, 1, 'la sélection reste');
  h.clear();
  assert.equal(a.children.length, 0);
  assert.equal(h.count('selected'), 0);
});

test('un nouvel affichage remplace le précédent du même emplacement', () => {
  const { door, wall } = scene();
  const h = new PartHighlight();
  h.show('hover', [{ object: door }]);
  h.show('hover', [{ object: wall }]);
  assert.equal(h.count('hover'), 1);
  assert.equal(door.children[0].children.length, 0);
});

test('les suiveurs ont leur propre teinte, dessinée par-dessus la sélection', () => {
  const { door, b } = scene();
  const h = new PartHighlight();
  h.show('selected', [{ object: door }]);
  h.show('follower', [{ object: b }]);
  const [sel, fol] = b.children;
  assert.notEqual(fol.material.color.getHex(), sel.material.color.getHex());
  assert.ok(fol.renderOrder > sel.renderOrder);
  h.clear();
  assert.equal(h.count('follower'), 0);
  assert.equal(b.children.length, 0);
});

test('une pièce se surligne par ses seuls triangles', () => {
  const { a } = scene();
  const h = new PartHighlight();
  h.show('selected', [{ mesh: a, tris: [0, 1] }]);
  const overlay = a.children[0];
  assert.notEqual(overlay.geometry, a.geometry);
  assert.equal(overlay.geometry.getAttribute('position').count, 6);
  h.clear();
});
