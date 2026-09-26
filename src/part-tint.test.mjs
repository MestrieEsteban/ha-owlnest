import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PartController } from './parts-runtime.mjs';
import { tintAt, tintColor, PartTint, untinted } from './part-tint.mjs';

function boxGeom(c, s) {
  const [x, y, z] = c;
  const [w, h, d] = s.map((v) => v / 2);
  const p = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    p.push(x + sx * w, y + sy * h, z + sz * d);
  }
  const idx = [
    0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5,
    0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6,
    0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
  ];
  return { p, idx };
}

const GREY = 0x808080;

/** Une porte et un mur dans la même maille, donc le même matériau. */
function model() {
  const door = boxGeom([0, 0, 0], [90, 6, 200]);
  const wall = boxGeom([500, 0, 0], [400, 20, 250]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...door.p, ...wall.p]), 3));
  g.setIndex([...door.idx, ...wall.idx.map((i) => i + 8)]);
  const shared = new THREE.MeshStandardMaterial({ color: GREY });
  const mesh = new THREE.Mesh(g, shared);
  mesh.name = 'MaisonHA';
  // Une autre maille qui partage le matériau.
  const other = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
  other.name = 'Autre';
  const root = new THREE.Group();
  root.add(mesh, other);
  return { root, mesh, other, shared };
}

const DOOR = {
  id: 'p1', entity: 'binary_sensor.porte', mesh: 'MaisonHA', triangle: 0,
  motion: 'swing', hinge: 'start', angle: 90, duration: 1,
};

function settle(c, id, f) {
  c.preview(id, f);
  let guard = 0;
  while (c.update(0.1) && guard++ < 100);
}

const piece = (c) => c.objectOf('p1');
const hex = (m) => m.color.getHex();

test('tintAt : fondu à deux couleurs, estompe à une seule, rien sans couleur', () => {
  assert.equal(tintAt(undefined, undefined, 0.5), null);
  const both = tintAt('#ff0000', '#0000ff', 0.5);
  assert.equal(both.weight, 1);
  assert.ok(both.color.r > 0 && both.color.b > 0 && both.color.g < 1e-6);
  assert.equal(tintAt('#ff0000', '#0000ff', 0).color.getHexString(), 'ff0000');
  assert.equal(tintAt('#ff0000', '#0000ff', 1).color.getHexString(), '0000ff');
  assert.equal(tintAt('#ff0000', undefined, 0.25).weight, 0.75);
  assert.equal(tintAt(undefined, '#00ff00', 0.25).weight, 0.25);
});

test('une couleur malformée vaut « pas de teinte »', () => {
  assert.equal(tintColor('red'), undefined);
  assert.equal(tintColor('#12345'), undefined);
  assert.equal(tintColor('#A0b1C2'), '#A0b1C2');
  assert.equal(tintAt('nope', undefined, 0), null);
});

test('sans couleur, les matériaux ne sont pas touchés', () => {
  const { root, shared } = model();
  const c = new PartController();
  c.build(root, [DOOR]);
  settle(c, 'p1', 1);
  assert.equal(piece(c).material, shared);
  assert.equal(hex(shared), GREY);
});

test('le matériau partagé n’est jamais modifié', () => {
  const { root, mesh, other, shared } = model();
  const c = new PartController();
  c.build(root, [{ ...DOOR, closedColor: '#ff0000' }]);
  c.update(1e6);
  const m = piece(c).material;
  assert.notEqual(m, shared, 'la pièce a sa propre copie');
  assert.notEqual(hex(m), GREY);
  assert.equal(hex(shared), GREY);
  assert.equal(shared.emissive.getHex(), 0);
  assert.equal(mesh.material, shared, 'le mur garde le matériau d’origine');
  assert.equal(other.material, shared);
});

test('couleur fermé à 0, ouvert à 1, fondu entre les deux', () => {
  const { root } = model();
  const c = new PartController();
  c.build(root, [{ ...DOOR, closedColor: '#ff0000', openColor: '#0000ff' }]);
  c.update(1e6);
  const m = piece(c).material;
  assert.ok(m.color.r > m.color.b, 'fermé : rouge');
  assert.ok(m.emissive.r > 0 && m.emissive.b < 1e-6);

  settle(c, 'p1', 1);
  assert.ok(m.color.b > m.color.r, 'ouvert : bleu');
  assert.ok(m.emissive.b > 0 && m.emissive.r < 1e-6);

  settle(c, 'p1', 0.5);
  assert.ok(m.emissive.r > 0 && m.emissive.b > 0, 'mi-course : mélange');
});

test('la teinte suit la position animée, pas la cible', () => {
  const { root } = model();
  const c = new PartController();
  c.build(root, [{ ...DOOR, openColor: '#0000ff' }]);
  c.update(1e6);
  assert.equal(piece(c).material.emissive.b, 0, 'fermé : sans teinte');
  c.preview('p1', 1);
  c.update(0.3);
  const mid = piece(c).material.emissive.b;
  assert.ok(mid > 0);
  c.update(1);
  assert.ok(piece(c).material.emissive.b > mid);
});

test('configure change les couleurs en direct et rend le matériau quand on les retire', () => {
  const { root, shared } = model();
  const c = new PartController();
  c.build(root, [DOOR]);
  c.update(1e6);
  assert.equal(c.configure({ ...DOOR, closedColor: '#00ff00' }), true);
  const m = piece(c).material;
  assert.notEqual(m, shared);
  assert.ok(m.color.g > m.color.r);

  c.configure({ ...DOOR, closedColor: '#ff0000' });
  assert.equal(piece(c).material, m, 'même copie, recolorée');
  assert.ok(m.color.r > m.color.g);

  let disposed = false;
  m.addEventListener('dispose', () => { disposed = true; });
  c.configure({ ...DOOR });
  assert.equal(piece(c).material, shared);
  assert.ok(disposed, 'la copie est libérée');
});

test('dispose rend les matériaux d’origine et libère les copies', () => {
  const { root, shared } = model();
  const c = new PartController();
  c.build(root, [{ ...DOOR, closedColor: '#ff0000' }]);
  c.update(1e6);
  const m = piece(c).material;
  let disposed = false;
  m.addEventListener('dispose', () => { disposed = true; });
  c.dispose(root);
  assert.ok(disposed);
  root.traverse((o) => { if (o.isMesh) assert.equal(o.material, shared); });
});

test('la copie garde le découpage injecté par cutaway', () => {
  const { root, shared } = model();
  const hook = () => {};
  shared.onBeforeCompile = hook;
  shared.customProgramCacheKey = () => 'owlnest-cutaway';
  shared.userData.owlnestCutaway = true;
  const c = new PartController();
  c.build(root, [{ ...DOOR, closedColor: '#ff0000' }]);
  c.update(1e6);
  const m = piece(c).material;
  assert.equal(m.onBeforeCompile, hook);
  assert.equal(m.customProgramCacheKey(), 'owlnest-cutaway');
});

// ── Nœuds ───────────────────────────────────────────────────────────────────

function groupModel() {
  const scene = new THREE.Group();
  const shared = new THREE.MeshStandardMaterial({ color: GREY });
  const handleMats = [new THREE.MeshStandardMaterial({ color: GREY }), shared];
  const door = new THREE.Group();
  door.name = 'porte';
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2, 0.06), shared);
  leaf.name = 'vantail';
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), handleMats);
  handle.name = 'poignee';
  handle.position.set(0.35, 0, 0.05);
  door.add(leaf, handle);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 2.5, 0.2), shared);
  wall.name = 'mur';
  wall.position.set(3, 0, 0);
  scene.add(wall, door);
  scene.updateMatrixWorld(true);
  return { scene, door, leaf, handle, wall, shared, handleMats };
}

const NODE_DOOR = {
  id: 'n1', entity: 'binary_sensor.porte', mesh: 'vantail', triangle: 0,
  node: 'porte', nodeIndex: 1, motion: 'swing', hinge: 'start', angle: 90, duration: 1,
};

test('un nœud teinte toutes ses mailles, multi-matériaux compris', () => {
  const { scene, leaf, handle, wall, shared, handleMats } = groupModel();
  const c = new PartController();
  c.setVertical(1);
  const res = c.build(scene, [{ ...NODE_DOOR, openColor: '#0000ff' }]);
  assert.equal(res.ok, 1);
  settle(c, 'n1', 1);
  assert.notEqual(leaf.material, shared);
  assert.ok(Array.isArray(handle.material) && handle.material.length === 2);
  assert.notEqual(handle.material[0], handleMats[0]);
  // Le matériau partagé au sein de l'objet n'est copié qu'une fois.
  assert.equal(handle.material[1], leaf.material);
  assert.equal(wall.material, shared);
  assert.equal(hex(shared), GREY);
  assert.ok(leaf.material.emissive.b > 0);

  c.dispose(scene);
  assert.equal(leaf.material, shared);
  assert.equal(handle.material[0], handleMats[0]);
  assert.equal(handle.material[1], shared);
});

test('un nœud ne teinte pas la pièce détachée d’un autre ouvrant qu’il contient', () => {
  const { scene, leaf, shared } = groupModel();
  const c = new PartController();
  c.setVertical(1);
  const inner = { ...NODE_DOOR, id: 'p2', node: undefined, nodeIndex: undefined, entity: 'binary_sensor.autre' };
  // Le nœud désigne ici la poignée seule pour laisser le vantail à la pièce.
  const res = c.build(scene, [{ ...NODE_DOOR, closedColor: '#ff0000' }, inner]);
  assert.equal(res.ok, 2);
  c.update(1e6);
  const detached = c.objectOf('p2');
  assert.equal(detached.material, shared, 'la pièce détachée garde l’original');
  assert.notEqual(leaf.material, shared, 'le reste du vantail est teinté');
});

test('une pièce détachée d’une maille teintée repart de l’original', () => {
  const { scene, leaf, shared } = groupModel();
  const c = new PartController();
  c.setVertical(1);
  const inner = { ...NODE_DOOR, id: 'p2', node: undefined, nodeIndex: undefined, entity: 'binary_sensor.autre' };
  const other = { ...inner, node: 'mur', nodeIndex: 0 };
  c.build(scene, [{ ...NODE_DOOR, closedColor: '#ff0000' }, other]);
  c.update(1e6);
  assert.notEqual(leaf.material, shared);
  // L'ouvrant du mur revient à une pièce du vantail teinté.
  assert.equal(c.configure(inner), true);
  assert.equal(c.objectOf('p2').material, shared);
});

test('PartTint sans couleur ne monte rien', () => {
  const { door, leaf, shared } = groupModel();
  const tint = new PartTint(door, 'x');
  assert.equal(tint.apply(undefined, undefined, 1), false);
  assert.equal(tint.active, false);
  assert.equal(leaf.material, shared);
  assert.equal(tint.apply('#ff0000', undefined, 0), true);
  assert.equal(tint.apply('#ff0000', undefined, 0), false, 'rien à refaire');
  assert.equal(untinted(leaf.material), shared);
  tint.restore();
  assert.equal(leaf.material, shared);
});
