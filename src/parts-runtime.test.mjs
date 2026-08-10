import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { openFraction, hasOpenSemantics, PartController, meshOrder, resolveMesh } from './parts-runtime.mjs';

// ── Lecture de l'état ───────────────────────────────────────────────────────

const COVER = 'cover.volet';
const DOOR_SENSOR = 'binary_sensor.porte';

test('openFraction lit les états discrets via le descripteur du domaine', () => {
  assert.equal(openFraction(COVER, 'open'), 1);
  assert.equal(openFraction(COVER, 'closed'), 0);
  assert.equal(openFraction(DOOR_SENSOR, 'on'), 1);
  assert.equal(openFraction(DOOR_SENSOR, 'off'), 0);
});

test('openFraction suit une position continue quand elle existe', () => {
  assert.equal(openFraction(COVER, 'open', { current_position: 100 }), 1);
  assert.equal(openFraction(COVER, 'open', { current_position: 40 }), 0.4);
  assert.equal(openFraction(COVER, 'closed', { current_position: 0 }), 0);
});

test('openFraction borne une position aberrante', () => {
  assert.equal(openFraction(COVER, 'open', { current_position: 140 }), 1);
  assert.equal(openFraction(COVER, 'open', { current_position: -20 }), 0);
});

test('openFraction traite une entité indisponible comme fermée', () => {
  assert.equal(openFraction(COVER, 'unavailable'), 0);
  assert.equal(openFraction(COVER, 'unknown'), 0);
  assert.equal(openFraction(COVER, undefined), 0);
  // Une position résiduelle ne doit pas rouvrir un ouvrant devenu injoignable.
  assert.equal(openFraction(COVER, 'unavailable', { current_position: 80 }), 0);
});

test('openWhen prime sur toute heuristique', () => {
  // Un capteur au vocabulaire maison : aucune table ne peut le deviner.
  assert.equal(openFraction('sensor.contact', 'detected', {}, ['detected']), 1);
  assert.equal(openFraction('sensor.contact', 'clear', {}, ['detected']), 0);
  // Et il l'emporte même sur une position continue.
  assert.equal(openFraction(COVER, 'closed', { current_position: 90 }, ['open']), 0);
});

test('un capteur numérique ne bloque pas la porte grande ouverte', () => {
  // Régression : le descripteur de `sensor` répond `isOn: () => true`, ce qui
  // est juste pour un badge mais laissait l'ouvrant béant et insensible.
  assert.equal(openFraction('sensor.temperature', '21.4', { unit_of_measurement: '°C' }), 0);
  assert.equal(openFraction('sensor.temperature', '30', {}), 0);
});

test('hasOpenSemantics distingue ce qui s’ouvre de ce qui se mesure', () => {
  assert.equal(hasOpenSemantics('cover.volet'), true);
  assert.equal(hasOpenSemantics('binary_sensor.porte'), true);
  assert.equal(hasOpenSemantics('lock.entree'), true);
  assert.equal(hasOpenSemantics('sensor.temperature'), false);
  assert.equal(hasOpenSemantics('weather.maison'), false);
});

test('un capteur muet redevient exploitable si on désigne ses états', () => {
  assert.equal(openFraction('sensor.contact', 'Ouvert', {}, ['Ouvert']), 1);
  assert.equal(openFraction('sensor.contact', 'Fermé', {}, ['Ouvert']), 0);
});

// ── Contrôleur ──────────────────────────────────────────────────────────────

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

/** Modèle minimal : une porte à l'origine, un mur à côté. */
function model() {
  const door = boxGeom([0, 0, 0], [90, 6, 200]);
  const wall = boxGeom([500, 0, 0], [400, 20, 250]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...door.p, ...wall.p]), 3));
  g.setIndex([...door.idx, ...wall.idx.map((i) => i + 8)]);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  mesh.name = 'MaisonHA';
  const root = new THREE.Group();
  root.add(mesh);
  return root;
}

/**
 * Nœud animé d'un ouvrant : le pivot, ajouté comme enfant de la maille.
 * La géométrie vit un cran plus bas, décalée pour compenser le côté des gonds.
 */
function animated(root) {
  return root.children[0].children[0];
}

const DOOR = {
  id: 'p1', entity: 'binary_sensor.porte', mesh: 'MaisonHA', triangle: 0,
  motion: 'swing', hinge: 'start', angle: 90, duration: 1,
};

test('build retrouve la pièce depuis son triangle d’amorce', () => {
  const root = model();
  const c = new PartController();
  const res = c.build(root, [DOOR]);
  assert.equal(res.ok, 1);
  assert.deepEqual(res.missing, []);
});

test('build signale une configuration dont la maille a disparu', () => {
  const c = new PartController();
  const res = c.build(model(), [{ ...DOOR, mesh: 'Absente' }]);
  assert.equal(res.ok, 0);
  assert.equal(res.missing.length, 1);
});

test('build signale un triangle hors du modèle', () => {
  const c = new PartController();
  const res = c.build(model(), [{ ...DOOR, triangle: 99999 }]);
  assert.equal(res.ok, 0);
  assert.equal(res.missing.length, 1);
});

test('le rang de maille départage deux mailles homonymes', () => {
  const root = model();
  // Une seconde maille du même nom, placée avant : sans le rang, c'est elle qui
  // serait animée.
  const twin = root.children[0].clone();
  twin.geometry = root.children[0].geometry.clone();
  root.add(twin);

  const order = meshOrder(root);
  assert.equal(order.length, 2);
  assert.equal(order[1].name, 'MaisonHA');

  const picked = resolveMesh(order, { mesh: 'MaisonHA', meshIndex: 1, triangle: 0 });
  assert.equal(picked, order[1], 'le rang doit primer sur l’ordre de recherche par nom');
});

test('un rang devenu faux retombe sur la recherche par nom', () => {
  const root = model();
  const order = meshOrder(root);
  const picked = resolveMesh(order, { mesh: 'MaisonHA', meshIndex: 42, triangle: 0 });
  assert.equal(picked, order[0], 'un modèle réexporté ne doit pas casser la scène');
});

test('un rang qui pointe une autre maille n’est pas suivi aveuglément', () => {
  const root = model();
  const other = root.children[0].clone();
  other.geometry = root.children[0].geometry.clone();
  other.name = 'Garage';
  root.add(other);

  const order = meshOrder(root);
  // Le rang 1 est « Garage », mais la configuration parle de « MaisonHA ».
  const picked = resolveMesh(order, { mesh: 'MaisonHA', meshIndex: 1, triangle: 0 });
  assert.equal(picked.name, 'MaisonHA', 'le nom arbitre en cas de désaccord');
});

test('la porte pivote quand l’entité passe à ouvert', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [DOOR]);

  assert.equal(c.applyStates({ 'binary_sensor.porte': { state: 'off' } }), false,
    'fermée au départ : rien ne change');
  assert.equal(c.applyStates({ 'binary_sensor.porte': { state: 'on' } }), true);

  // Une seconde d'animation pour une durée d'une seconde : ouverture complète.
  let guard = 0;
  while (c.update(0.1) && guard++ < 100);
  const angle = Math.abs(animated(root).rotation.z);
  assert.ok(Math.abs(angle - Math.PI / 2) < 1e-6, `attendu 90°, obtenu ${THREE.MathUtils.radToDeg(angle)}°`);
});

test('l’animation est progressive, pas instantanée', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [DOOR]);
  c.applyStates({ 'binary_sensor.porte': { state: 'on' } });

  c.update(0.25);
  const quarter = Math.abs(animated(root).rotation.z);
  assert.ok(quarter > 0.01 && quarter < Math.PI / 2 - 0.01,
    'à un quart de la durée, la porte est entrouverte');
});

test('invert échange ouvert et fermé', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [{ ...DOOR, invert: true }]);
  assert.equal(c.applyStates({ 'binary_sensor.porte': { state: 'off' } }), true,
    'fermée côté HA, donc ouverte à l’écran');
  let guard = 0;
  while (c.update(0.1) && guard++ < 100);
  assert.ok(Math.abs(Math.abs(animated(root).rotation.z) - Math.PI / 2) < 1e-6);
});

test('le côté des gonds change le sens de rotation', () => {
  const mk = (hinge) => {
    const root = model();
    const c = new PartController();
    c.build(root, [{ ...DOOR, hinge }]);
    c.applyStates({ 'binary_sensor.porte': { state: 'on' } });
    let guard = 0;
    while (c.update(0.1) && guard++ < 100);
    return animated(root).rotation.z;
  };
  assert.ok(mk('start') * mk('end') < 0, 'les deux côtés ouvrent en sens opposés');
});

test('un volet coulisse au lieu de pivoter', () => {
  const root = model();
  const c = new PartController();
  const cover = {
    id: 'v1', entity: 'cover.volet', mesh: 'MaisonHA', triangle: 0,
    motion: 'slide', slide: 'down', travel: 1, duration: 1,
  };
  c.build(root, [cover]);
  const part = animated(root);
  const start = part.position.z;

  c.applyStates({ 'cover.volet': { state: 'open', attributes: { current_position: 100 } } });
  let guard = 0;
  while (c.update(0.1) && guard++ < 100);

  assert.equal(part.rotation.z, 0, 'un coulissant ne tourne pas');
  assert.ok(Math.abs((start - part.position.z) - 200) < 1e-6,
    'il se retire de toute sa hauteur');
});

test('une position intermédiaire de volet est respectée', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [{ id: 'v1', entity: 'cover.volet', mesh: 'MaisonHA', triangle: 0, motion: 'slide', duration: 1 }]);
  const part = animated(root);
  const start = part.position.z;

  c.applyStates({ 'cover.volet': { state: 'open', attributes: { current_position: 30 } } });
  let guard = 0;
  while (c.update(0.1) && guard++ < 100);
  assert.ok(Math.abs((start - part.position.z) - 60) < 1e-6, 'à 30 %, 60 cm sur 200');
});

test('update rend la main une fois l’animation terminée', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [DOOR]);
  c.applyStates({ 'binary_sensor.porte': { state: 'on' } });
  let guard = 0;
  while (c.update(0.1) && guard++ < 200);
  assert.ok(guard < 200, 'la boucle de rendu doit pouvoir se rendormir');
  assert.equal(c.update(0.1), false);
});

test('configure applique un réglage sans redécouper le modèle', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [DOOR]);
  const leaf = animated(root).children[0];
  const geometryBefore = leaf.geometry;
  const trisBefore = root.children[0].geometry.getIndex().count;

  assert.equal(c.configure({ ...DOOR, angle: 30 }), true);
  c.applyStates({ 'binary_sensor.porte': { state: 'on' } });
  let guard = 0;
  while (c.update(0.1) && guard++ < 100);

  assert.ok(Math.abs(Math.abs(animated(root).rotation.z) - Math.PI / 6) < 1e-6,
    'le nouvel angle prend effet tout de suite');
  assert.equal(leaf.geometry, geometryBefore, 'la géométrie n’est pas retouchée');
  assert.equal(root.children[0].geometry.getIndex().count, trisBefore,
    'la maille d’origine n’est pas re-découpée');
});

test('changer de côté de gonds ne demande plus de reconstruction', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [DOOR]);
  const open = () => {
    c.applyStates({ 'binary_sensor.porte': { state: 'on' } });
    let guard = 0;
    while (c.update(0.1) && guard++ < 100);
    return animated(root).rotation.z;
  };
  const a = open();

  c.configure({ ...DOOR, hinge: 'end' });
  const b = open();
  assert.ok(a * b < 0, 'les deux côtés ouvrent en sens opposés');
});

test('le gond reste immobile après un changement de côté', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [{ ...DOOR, hinge: 'end' }]);
  root.updateMatrixWorld(true);

  const node = animated(root);
  const closed = node.localToWorld(new THREE.Vector3(0, 0, 0));
  c.preview('p1', 1);
  let guard = 0;
  while (c.update(0.1) && guard++ < 100);
  root.updateMatrixWorld(true);
  const opened = node.localToWorld(new THREE.Vector3(0, 0, 0));

  assert.ok(closed.distanceTo(opened) < 1e-6, 'le pivot ne se déplace jamais');
});

test('configure sur un ouvrant absent ne fait rien et le signale', () => {
  const c = new PartController();
  c.build(model(), [DOOR]);
  assert.equal(c.configure({ ...DOOR, id: 'inconnu' }), false);
});

test('passer de battant à coulissant change la nature du mouvement', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [DOOR]);
  const node = animated(root);
  const rest = node.position.z;

  c.configure({ ...DOOR, motion: 'slide', slide: 'down', travel: 1 });
  c.applyStates({ 'binary_sensor.porte': { state: 'on' } });
  let guard = 0;
  while (c.update(0.1) && guard++ < 100);

  assert.equal(node.rotation.z, 0, 'un coulissant ne tourne pas');
  assert.ok(Math.abs((rest - node.position.z) - 200) < 1e-6, 'il descend de sa hauteur');
});

test('dispose retire les pièces détachées', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [DOOR]);
  assert.equal(root.children[0].children.length, 1);
  c.dispose(root);
  assert.equal(root.children[0].children.length, 0);
  assert.equal(c.count, 0);
});
