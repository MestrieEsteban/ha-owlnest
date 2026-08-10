import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildPartIndex, partFrame, hingePivot, extractPart, removeTriangles, guessPart,
} from './parts.mjs';

/** Géométrie indexée à partir de sommets bruts et d'une liste de triangles. */
function geom(positions, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(indices);
  return g;
}

/** Pavé droit centré sur `c`, de dimensions `s`. Douze triangles, huit sommets. */
function boxGeom(c = [0, 0, 0], s = [1, 1, 1]) {
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

// ── Composantes connexes ────────────────────────────────────────────────────

test('deux objets éloignés forment deux pièces', () => {
  const a = boxGeom([0, 0, 0], [1, 1, 1]);
  const b = boxGeom([50, 0, 0], [1, 1, 1]);
  const g = geom([...a.p, ...b.p], [...a.idx, ...b.idx.map((i) => i + 8)]);
  const index = buildPartIndex(g);
  assert.equal(index.parts.length, 2);
  assert.equal(index.triangleCount, 24);
  assert.equal(index.parts[0].tris.length, 12);
  assert.equal(index.parts[1].tris.length, 12);
});

test('des sommets dupliqués à la même position ne découpent pas la pièce', () => {
  // Deux triangles partageant une arête, mais avec des sommets distincts :
  // c'est ce que produit une couture d'UV.
  const g = geom(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, /* doublons */ 1, 0, 0, 0, 1, 0, 1, 1, 0],
    [0, 1, 2, 3, 5, 4],
  );
  assert.equal(buildPartIndex(g).parts.length, 1, 'la soudure par position doit recoller les deux');
});

test('les pièces sont classées par nombre de triangles décroissant', () => {
  const big = boxGeom([0, 0, 0], [1, 1, 1]);
  const small = { p: [50, 0, 0, 51, 0, 0, 50, 1, 0], idx: [0, 1, 2] };
  const g = geom([...small.p, ...big.p], [...small.idx, ...big.idx.map((i) => i + 3)]);
  const index = buildPartIndex(g);
  assert.equal(index.parts[0].tris.length, 12);
  assert.equal(index.parts[1].tris.length, 1);
  assert.equal(index.ofTriangle[0], 1, 'le petit triangle appartient à la seconde pièce');
});

test('la boîte englobante de la pièce est correcte', () => {
  const b = boxGeom([10, 5, 0], [2, 4, 6]);
  const index = buildPartIndex(geom(b.p, b.idx));
  const box = index.parts[0].box;
  assert.deepEqual([box.min.x, box.min.y, box.min.z], [9, 3, -3]);
  assert.deepEqual([box.max.x, box.max.y, box.max.z], [11, 7, 3]);
});

// ── Repère de l'ouvrant ─────────────────────────────────────────────────────

test('partFrame classe hauteur, largeur et épaisseur', () => {
  // Une porte : 90 large (x), 5 épaisse (y), 200 haute (z).
  const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(90, 5, 200));
  const f = partFrame(box);
  assert.equal(f.up, 2, 'la hauteur est le plus grand axe');
  assert.equal(f.wide, 0);
  assert.equal(f.thin, 1);
});

test('partFrame ne présume aucune orientation du modèle', () => {
  // Même porte, modèle en Y-up : hauteur sur y.
  const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(90, 200, 5));
  const f = partFrame(box);
  assert.equal(f.up, 1);
  assert.equal(f.wide, 0);
  assert.equal(f.thin, 2);
});

test('le gond se pose sur une arête verticale, au milieu de l’épaisseur', () => {
  const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(90, 6, 200));
  const f = partFrame(box);

  const start = hingePivot(box, f, 'start');
  assert.deepEqual([start.x, start.y, start.z], [0, 3, 0]);

  const end = hingePivot(box, f, 'end');
  assert.deepEqual([end.x, end.y, end.z], [90, 3, 0], 'l’autre côté du vantail');
});

test('le gond n’est jamais au centre du vantail', () => {
  // Garde-fou contre la régression classique : un pivot central fait traverser
  // le mur à la porte.
  const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(90, 6, 200));
  const f = partFrame(box);
  const centre = box.getCenter(new THREE.Vector3());
  for (const side of ['start', 'end']) {
    const p = hingePivot(box, f, side);
    assert.notEqual(p.getComponent(f.wide), centre.getComponent(f.wide));
  }
});

// ── Extraction ──────────────────────────────────────────────────────────────

function twoBoxMesh() {
  const door = boxGeom([0, 0, 0], [90, 6, 200]);
  const wall = boxGeom([500, 0, 0], [400, 20, 250]);
  const g = geom([...door.p, ...wall.p], [...door.idx, ...wall.idx.map((i) => i + 8)]);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}

test('extractPart détache la pièce et la retire de la maille d’origine', () => {
  const mesh = twoBoxMesh();
  const index = buildPartIndex(mesh.geometry);
  const door = index.parts.find((p) => p.box.max.x <= 100);
  assert.ok(door, 'la porte doit être trouvée');

  const before = mesh.geometry.getIndex().count / 3;
  const { mesh: detached } = extractPart(mesh, door);

  assert.equal(detached.geometry.getAttribute('position').count, door.tris.length * 3);
  assert.equal(mesh.geometry.getIndex().count / 3, before - door.tris.length,
    'les triangles détachés ne doivent plus être rendus deux fois');
  assert.equal(detached.parent, mesh, 'la pièce hérite de la transformation de son maillage');
});

test('la géométrie détachée est exprimée par rapport au gond', () => {
  const mesh = twoBoxMesh();
  const index = buildPartIndex(mesh.geometry);
  const door = index.parts.find((p) => p.box.max.x <= 100);
  const { mesh: detached, pivot } = extractPart(mesh, door, 'start');

  // Le gond passe à l'origine locale : une rotation y est donc correcte.
  const box = detached.geometry.boundingBox;
  assert.equal(box.min.x, 0, 'l’arête des gonds est à l’origine');
  assert.ok(Math.abs(box.min.z) < 1e-6, 'le bas du vantail aussi');

  // Et la pièce revient à sa place une fois le décalage appliqué.
  assert.ok(Math.abs(pivot.x - door.box.min.x) < 1e-6);
  assert.ok(Math.abs(detached.position.x + box.max.x - door.box.max.x) < 1e-6);
});

test('une rotation autour du gond garde le vantail dans l’embrasure', () => {
  const mesh = twoBoxMesh();
  mesh.updateMatrixWorld(true);
  const index = buildPartIndex(mesh.geometry);
  const door = index.parts.find((p) => p.box.max.x <= 100);
  const { mesh: detached, frame } = extractPart(mesh, door, 'start');

  const axis = ['x', 'y', 'z'][frame.up];
  const corner = new THREE.Vector3(0, 0, 0);           // le gond, en local
  detached.rotation[axis] = Math.PI / 2;
  detached.updateMatrixWorld(true);
  const moved = detached.localToWorld(corner.clone());

  assert.ok(moved.distanceTo(new THREE.Vector3(door.box.min.x, (door.box.min.y + door.box.max.y) / 2, door.box.min.z)) < 1e-6,
    'le point du gond ne bouge pas quand la porte pivote');
});

test('removeTriangles conserve exactement les autres triangles', () => {
  const mesh = twoBoxMesh();
  const total = mesh.geometry.getIndex().count / 3;
  removeTriangles(mesh, [0, 5, 9]);
  assert.equal(mesh.geometry.getIndex().count / 3, total - 3);
});

// ── Reconnaissance ──────────────────────────────────────────────────────────

test('guessPart reconnaît une porte, une fenêtre, et rejette le reste', () => {
  const box = (w, d, h) => new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, d, h));
  assert.equal(guessPart(box(90, 6, 204)), 'door');
  assert.equal(guessPart(box(64, 2, 123)), 'window');
  assert.equal(guessPart(box(400, 20, 250)), 'other', 'un mur est trop épais');
  assert.equal(guessPart(box(90, 6, 400)), 'other', 'trop haut pour une porte');
});

test('guessPart travaille en centimètres même sur un modèle en mètres', () => {
  const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.9, 0.06, 2.04));
  assert.equal(guessPart(box), 'other', 'sans conversion, les cotes n’ont aucun sens');
  assert.equal(guessPart(box, 100), 'door');
});
