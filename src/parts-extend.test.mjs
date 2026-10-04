import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PartController } from './parts-runtime.mjs';
import { detectExtend, extendDirection, extendSpan, edgeContact } from './parts.mjs';

// ── Un store banne de synthèse, Y en haut, en mètres ────────────────────────
// Mur en z = 0, maison du côté z < 0. La toile part du coffre (y = 2,5) et
// descend vers l'extérieur de 30° sous l'horizontale, sur 2 m, pour 3 m de large.

const L = 2;
const W = 3;
const TILT = 30;
const E = new THREE.Vector3(0, -Math.sin(TILT * Math.PI / 180), Math.cos(TILT * Math.PI / 180));
const A0 = new THREE.Vector3(0, 2.5, 0.05);
const A1 = new THREE.Vector3(W, 2.5, 0.05);
const B0 = A0.clone().addScaledVector(E, L);
const B1 = A1.clone().addScaledVector(E, L);
const FAR_MID = B0.clone().add(B1).multiplyScalar(0.5);

function boxGeom(center, size) {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  g.translate(center[0], center[1], center[2]);
  return g;
}

function quadGeom(pts) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flatMap((p) => p.toArray())), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

const mat = () => new THREE.MeshBasicMaterial();
const named = (name, geom) => { const m = new THREE.Mesh(geom, mat()); m.name = name; return m; };

const house = () => named('House', boxGeom([1.5, 1.25, -3], [8, 2.5, 6]));
const motor = () => named('motor', boxGeom([1.5, 2.6, 0.1], [3.2, 0.2, 0.2]));
const barGeom = () => boxGeom([FAR_MID.x, FAR_MID.y - 0.03, FAR_MID.z], [W, 0.05, 0.06]);
const fabricGeom = () => quadGeom([A0, A1, B1, B0]);

/** Toile et barre sœurs, sans transformation. */
function siblingScene() {
  const root = new THREE.Group();
  const tela = named('tela', fabricGeom());
  const bar = named('bar', barGeom());
  root.add(house(), motor(), tela, bar);
  root.updateMatrixWorld(true);
  return { root, tela, bar };
}

/**
 * Comme l'export réel : la toile porte une rotation et une échelle non
 * uniforme, et la barre est son enfant.
 */
function childScene() {
  const root = new THREE.Group();
  const tela = named('tela', quadGeom([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.5, 0, 0),
    new THREE.Vector3(1.5, 4, 0), new THREE.Vector3(0, 4, 0),
  ]));
  // Local y → direction E (rotation de 120° autour de X), échelle (2, 0,5, 1).
  tela.position.copy(A0);
  tela.rotation.x = THREE.MathUtils.degToRad(120);
  tela.scale.set(2, 0.5, 1);
  const bar = named('extremo', boxGeom([0, 0, 0], [W, 0.05, 0.06]));
  bar.position.set(0.75, 4, 0);
  bar.scale.set(0.5, 2, 1);
  tela.add(bar);
  root.add(house(), motor(), tela);
  root.updateMatrixWorld(true);
  return { root, tela, bar };
}

/** Export Z-up redressé : +90° autour de X et échelle 0,01 sur un nœud englobant. */
function zUpScene() {
  const root = new THREE.Group();
  const wrap = new THREE.Group();
  wrap.rotation.x = Math.PI / 2;
  wrap.scale.setScalar(0.01);
  wrap.updateMatrix();
  const inv = wrap.matrix.clone().invert();
  const bake = (m) => { m.geometry.applyMatrix4(inv); return m; };
  const tela = bake(named('tela', fabricGeom()));
  const bar = bake(named('bar', barGeom()));
  wrap.add(bake(house()), bake(motor()), tela, bar);
  root.add(wrap);
  root.updateMatrixWorld(true);
  return { root, tela, bar };
}

function worldVerts(mesh) {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.getAttribute('position');
  const out = [];
  for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  return out;
}

function near(a, b, eps = 1e-4, msg = '') {
  assert.ok(a.distanceTo(b) < eps, `${msg} ${a.toArray().map((v) => v.toFixed(5))} ≠ ${b.toArray().map((v) => v.toFixed(5))}`);
}

/** Pose attendue d'un point de la toile : écrasé vers le plan de l'arête fixe, le long de `u`. */
const squash = (v, u, anchor, s) => v.clone().addScaledVector(u, (s - 1) * (v.dot(u) - anchor));

const AWNING = { id: 'aw', entity: 'cover.toldo', mesh: '', triangle: 0, node: 'tela', motion: 'extend', duration: 1 };

function mount(scene, cfg = AWNING) {
  const c = new PartController();
  c.setVertical(1);
  const res = c.build(scene.root, [cfg]);
  assert.equal(res.ok, 1);
  return c;
}

function at(c, root, fraction, id = 'aw') {
  c.preview(id, fraction);
  c.update(1e6);
  root.updateMatrixWorld(true);
}

// ── Détection ───────────────────────────────────────────────────────────────

const flat = (pts) => new Float32Array(pts.flatMap((p) => p.toArray()));
const UP = new THREE.Vector3(0, 1, 0);
const CENTER = new THREE.Vector3(1.5, 1.25, -3);

test('detectExtend lit un store banne incliné : axe sortant, pente, sens', () => {
  const f = detectExtend(flat([A0, A1, B1, B0]), UP, CENTER);
  assert.equal(f.axis, 'out');
  assert.ok(Math.abs(f.tilt - TILT) < 0.01, `pente ${f.tilt}`);
  near(f.out, new THREE.Vector3(0, 0, 1), 1e-6, 'out');
  assert.ok(Math.abs(Math.abs(f.along.x) - 1) < 1e-6, 'le long du mur = X');
  // L'arête fixe est le bord haut, contre le mur.
  const u = extendDirection(f, f.axis, f.tilt);
  near(u, E, 1e-6, 'direction');
  const span = extendSpan(flat([A0, A1, B1, B0]), f, u, 'start');
  assert.ok(Math.abs(span.anchor - A0.dot(u)) < 1e-6);
  assert.ok(Math.abs(span.far - B0.dot(u)) < 1e-6);
});

test('detectExtend : une toile verticale est un store, une toile à plat sort à l’opposé de la maison', () => {
  const hang = [A0, A1, new THREE.Vector3(W, 0.5, 0.05), new THREE.Vector3(0, 0.5, 0.05)];
  const v = detectExtend(flat(hang), UP, CENTER);
  assert.equal(v.axis, 'vertical');
  assert.ok(Math.abs(v.tilt - 90) < 0.01);
  near(v.out, new THREE.Vector3(0, 0, 1), 1e-6, 'extérieur');

  const lay = [A0, A1, new THREE.Vector3(W, 2.5, 1.5), new THREE.Vector3(0, 2.5, 1.5)];
  const h = detectExtend(flat(lay), UP, CENTER);
  assert.equal(h.axis, 'out');
  assert.ok(Math.abs(h.tilt) < 0.01);
  near(h.out, new THREE.Vector3(0, 0, 1), 1e-6, 'extérieur');
});

test('edgeContact retient la barre de l’arête mobile, pas le coffre ni la maison', () => {
  const pts = flat([A0, A1, B1, B0]);
  const f = detectExtend(pts, UP, CENTER);
  const span = extendSpan(pts, f, extendDirection(f, 'out', f.tilt), 'start');
  const corners = (g) => { g.computeBoundingBox(); const b = g.boundingBox; const o = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) o.push(x, y, z);
    return o; };
  assert.notEqual(edgeContact(corners(barGeom()), span), null);
  assert.equal(edgeContact(corners(motor().geometry), span), null);
  assert.equal(edgeContact(corners(house().geometry), span), null);
});

// ── Animation ───────────────────────────────────────────────────────────────

for (const [label, make] of [['nœud sans transformation', siblingScene], ['nœud tourné et étiré', childScene], ['modèle Z-up redressé', zUpScene]]) {
  test(`déroulant (${label}) : arête fixe immobile, arête mobile le long de l’axe incliné`, () => {
    const scene = make();
    const rest = worldVerts(scene.tela);
    const c = mount(scene);
    at(c, scene.root, 1);
    // Pose du modèle intacte une fois ouvert, réglages par défaut.
    worldVerts(scene.tela).forEach((v, i) => near(v, rest[i], 1e-4, 'repos'));
    for (const f of [0.75, 0.5, 0.25, 0]) {
      at(c, scene.root, f);
      const s = Math.max(1e-3, f);
      worldVerts(scene.tela).forEach((v, i) => near(v, squash(rest[i], E, A0.dot(E), s), 1e-4, `f=${f}`));
    }
  });

  test(`déroulant (${label}) : la barre suit l’arête mobile sans être déformée`, () => {
    const scene = make();
    const bar0 = worldVerts(scene.bar);
    const c = mount(scene);
    for (const f of [1, 0.6, 0.3, 0]) {
      at(c, scene.root, f);
      const s = Math.max(1e-3, f);
      const d = E.clone().multiplyScalar((s - 1) * L);
      worldVerts(scene.bar).forEach((v, i) => near(v, bar0[i].clone().add(d), 1e-4, `f=${f}`));
    }
  });
}

test('le démontage rend la toile et la barre à leur pose et leurs matrices', () => {
  for (const make of [siblingScene, childScene, zUpScene]) {
    const scene = make();
    const tela0 = worldVerts(scene.tela);
    const bar0 = worldVerts(scene.bar);
    const barLocal = scene.bar.matrix.clone();
    const parent = scene.tela.parent;
    const c = mount(scene);
    at(c, scene.root, 0.3);
    c.dispose(scene.root);
    scene.root.updateMatrixWorld(true);
    assert.equal(scene.tela.parent, parent);
    assert.equal(scene.bar.matrixAutoUpdate, true);
    assert.ok(scene.bar.matrix.equals(barLocal));
    worldVerts(scene.tela).forEach((v, i) => near(v, tela0[i]));
    worldVerts(scene.bar).forEach((v, i) => near(v, bar0[i]));
  }
});

test('sans liste, la barre qui touche l’arête mobile est suggérée et suivie', () => {
  const scene = siblingScene();
  const c = mount(scene);
  const info = c.extendInfo('aw');
  assert.equal(info.axis, 'out');
  assert.ok(Math.abs(info.tilt - TILT) < 0.01);
  assert.ok(Math.abs(info.length - L) < 1e-4);
  assert.deepEqual(info.suggested.map((r) => r.node), ['bar']);
  assert.equal(info.candidates[0].node, 'bar');
  assert.equal(info.candidates[0].touching, true);
  assert.ok(info.candidates.some((x) => x.node === 'motor' && !x.touching));
});

test('une liste vide de suiveurs laisse la barre en place', () => {
  const scene = siblingScene();
  const bar0 = worldVerts(scene.bar);
  const c = mount(scene, { ...AWNING, followers: [] });
  at(c, scene.root, 0);
  worldVerts(scene.bar).forEach((v, i) => near(v, bar0[i]));
});

test('une pièce détachée d’une maille fusionnée se replie aussi (Z-up)', () => {
  const root = new THREE.Group();
  const wrap = new THREE.Group();
  wrap.rotation.x = Math.PI / 2;
  wrap.scale.setScalar(0.01);
  wrap.updateMatrix();
  const inv = wrap.matrix.clone().invert();
  const parts = [fabricGeom(), boxGeom([1.5, 1.25, -3], [8, 2.5, 6]).toNonIndexed()];
  const merged = new THREE.BufferGeometry();
  const quad = parts[0].toNonIndexed();
  const pos = new Float32Array([...quad.getAttribute('position').array, ...parts[1].getAttribute('position').array]);
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.applyMatrix4(inv);
  const mesh = named('Maison', merged);
  wrap.add(mesh);
  root.add(wrap);
  root.updateMatrixWorld(true);

  const c = mount({ root }, { ...AWNING, node: undefined, mesh: 'Maison', triangle: 0 });
  at(c, root, 1);
  const piece = c.objectOf('aw');
  const rest = worldVerts(piece);
  for (const v of rest) assert.ok(Math.abs((v.clone().sub(A0)).dot(new THREE.Vector3(1, 0, 0).cross(E))) < 1e-4, 'dans le plan de la toile');
  at(c, root, 0.4);
  worldVerts(piece).forEach((v, i) => near(v, squash(rest[i], E, A0.dot(E), 0.4), 1e-4));
});

test('tailles ouvert et fermé : bornes de l’écrasement', () => {
  const scene = siblingScene();
  const rest = worldVerts(scene.tela);
  const c = mount(scene, { ...AWNING, extendOpen: 0.8, extendClosed: 0.2 });
  at(c, scene.root, 0);
  worldVerts(scene.tela).forEach((v, i) => near(v, squash(rest[i], E, A0.dot(E), 0.2)));
  at(c, scene.root, 1);
  worldVerts(scene.tela).forEach((v, i) => near(v, squash(rest[i], E, A0.dot(E), 0.8)));
  // La barre reste collée à l'arête mobile, même quand l'ouvert n'est pas la pose du modèle.
  const bar0 = siblingScene().bar;
  const d = E.clone().multiplyScalar((0.8 - 1) * L);
  worldVerts(scene.bar).forEach((v, i) => near(v, worldVerts(bar0)[i].clone().add(d)));
});

test('inclinaison forcée à 0° : l’arête mobile recule à l’horizontale', () => {
  const scene = siblingScene();
  const rest = worldVerts(scene.tela);
  const c = mount(scene, { ...AWNING, extendTilt: 0 });
  at(c, scene.root, 0.5);
  const u = new THREE.Vector3(0, 0, 1);
  worldVerts(scene.tela).forEach((v, i) => {
    near(v, squash(rest[i], u, A0.z, 0.5));
    assert.ok(Math.abs(v.y - rest[i].y) < 1e-6, 'hauteur inchangée');
  });
});

test('arête fixe à l’extrémité : c’est le bord haut qui descend', () => {
  const scene = siblingScene();
  const rest = worldVerts(scene.tela);
  const c = mount(scene, { ...AWNING, extendAnchor: 'end', followers: [] });
  at(c, scene.root, 0.5);
  worldVerts(scene.tela).forEach((v, i) => near(v, squash(rest[i], E, B0.dot(E), 0.5)));
});

test('rideau : axes vertical et le long du mur', () => {
  const hang = [A0, A1, new THREE.Vector3(W, 0.5, 0.05), new THREE.Vector3(0, 0.5, 0.05)];
  const mk = () => {
    const root = new THREE.Group();
    const tela = named('tela', quadGeom(hang));
    root.add(house(), tela);
    root.updateMatrixWorld(true);
    return { root, tela };
  };
  const a = mk();
  const restA = worldVerts(a.tela);
  const ca = mount(a);
  at(ca, a.root, 0.5);
  worldVerts(a.tela).forEach((v, i) => near(v, squash(restA[i], new THREE.Vector3(0, -1, 0), -2.5, 0.5)));

  const b = mk();
  const restB = worldVerts(b.tela);
  const cb = mount(b, { ...AWNING, extendAxis: 'along' });
  at(cb, b.root, 0.5);
  const info = cb.extendInfo('aw');
  const along = new THREE.Vector3(1, 0, 0);
  // `along` = up × out, soit +X ici : l'arête fixe est x = 0.
  worldVerts(b.tela).forEach((v, i) => near(v, squash(restB[i], along, 0, 0.5)));
  assert.equal(info.axis, 'vertical');
});

// ── États ───────────────────────────────────────────────────────────────────

test('volet sans position : seuls ouvert et fermé comptent', () => {
  const scene = siblingScene();
  const rest = worldVerts(scene.tela);
  const c = mount(scene);
  c.applyStates({ 'cover.toldo': { state: 'closed' } });
  c.update(1e6); scene.root.updateMatrixWorld(true);
  worldVerts(scene.tela).forEach((v, i) => near(v, squash(rest[i], E, A0.dot(E), 1e-3)));
  c.applyStates({ 'cover.toldo': { state: 'open' } });
  c.update(1e6); scene.root.updateMatrixWorld(true);
  worldVerts(scene.tela).forEach((v, i) => near(v, rest[i]));
});

test('position rapportée et « fermé à 100 % »', () => {
  const scene = siblingScene();
  const rest = worldVerts(scene.tela);
  const c = mount(scene);
  c.applyStates({ 'cover.toldo': { state: 'open', attributes: { current_position: 25 } } });
  c.update(1e6); scene.root.updateMatrixWorld(true);
  worldVerts(scene.tela).forEach((v, i) => near(v, squash(rest[i], E, A0.dot(E), 0.25)));

  c.configure({ ...AWNING, invert: true });
  c.applyStates({ 'cover.toldo': { state: 'open', attributes: { current_position: 25 } } });
  c.update(1e6); scene.root.updateMatrixWorld(true);
  worldVerts(scene.tela).forEach((v, i) => near(v, squash(rest[i], E, A0.dot(E), 0.75)));
});

test('l’animation suit la durée', () => {
  const scene = siblingScene();
  const rest = worldVerts(scene.tela);
  const c = mount(scene, { ...AWNING, duration: 2 });
  c.applyStates({ 'cover.toldo': { state: 'open' } });
  c.update(1e6);
  c.applyStates({ 'cover.toldo': { state: 'closed' } });
  assert.equal(c.update(0.5), true);
  scene.root.updateMatrixWorld(true);
  worldVerts(scene.tela).forEach((v, i) => near(v, squash(rest[i], E, A0.dot(E), 0.75)));
});

// ── Suiveurs ────────────────────────────────────────────────────────────────

test('un suiveur n’est pas tenu par deux ouvrants : le second est averti', () => {
  const scene = siblingScene();
  const tela2 = named('tela2', fabricGeom());
  scene.root.add(tela2);
  const bar0 = worldVerts(scene.bar);
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const c = new PartController();
    c.setVertical(1);
    const res = c.build(scene.root, [
      { ...AWNING, followers: [{ node: 'bar' }] },
      { ...AWNING, id: 'aw2', node: 'tela2', entity: 'cover.b', followers: [{ node: 'bar' }] },
    ]);
    assert.equal(res.ok, 2);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /bar/);
    // Seul le premier la déplace.
    c.preview('aw', 1); c.preview('aw2', 0); c.update(1e6); scene.root.updateMatrixWorld(true);
    worldVerts(scene.bar).forEach((v, i) => near(v, bar0[i]));
  } finally {
    console.warn = orig;
  }
});

test('une cible l’emporte sur un suiveur', () => {
  const scene = siblingScene();
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const c = new PartController();
    c.setVertical(1);
    // Le déroulant est déclaré d'abord : la cible gagne malgré l'ordre.
    const res = c.build(scene.root, [
      { ...AWNING, followers: [{ node: 'bar' }] },
      { id: 'door', entity: 'binary_sensor.x', mesh: '', triangle: 0, node: 'bar', motion: 'slide', duration: 1 },
    ]);
    assert.equal(res.ok, 2);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /bar.*binary_sensor\.x/);
    assert.equal(c.extendInfo('aw').suggested.length, 0);
  } finally {
    console.warn = orig;
  }
});

test('repasser en battant libère la barre et le pivot', () => {
  const scene = childScene();
  const bar0 = worldVerts(scene.bar);
  const c = mount(scene);
  at(c, scene.root, 0.4);
  c.configure({ ...AWNING, motion: 'swing', angle: 90 });
  at(c, scene.root, 0);
  assert.equal(scene.bar.matrixAutoUpdate, true);
  worldVerts(scene.bar).forEach((v, i) => near(v, bar0[i]));
});

test('une teinte d’état couvre aussi un suiveur voisin', () => {
  const scene = siblingScene();
  const original = scene.bar.material;
  const c = mount(scene, { ...AWNING, closedColor: '#ff0000' });
  at(c, scene.root, 0);
  assert.notEqual(scene.bar.material, original);
  c.dispose(scene.root);
  assert.equal(scene.bar.material, original);
});
