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

test('swingSide inverse le sens d’ouverture, quel que soit le côté des gonds', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [DOOR]);
  const open = (cfg) => {
    c.configure(cfg);
    c.preview('p1', 0);
    let guard = 0;
    while (c.update(0.1) && guard++ < 100);
    c.preview('p1', 1);
    guard = 0;
    while (c.update(0.1) && guard++ < 100);
    return animated(root).rotation.z;
  };

  for (const hinge of ['start', 'end']) {
    const front = open({ ...DOOR, hinge });
    const back = open({ ...DOOR, hinge, swingSide: 'back' });
    assert.ok(Math.abs(Math.abs(front) - Math.PI / 2) < 1e-6, 'l’angle est conservé');
    assert.ok(Math.abs(front + back) < 1e-6, `gonds ${hinge} : les deux côtés s’opposent`);
  }
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

// ── Abattant ────────────────────────────────────────────────────────────────

const FLAP = { ...DOOR, swingAxis: 'horizontal' };

function openFully(c, root) {
  c.preview('p1', 0);
  let guard = 0;
  while (c.update(0.1) && guard++ < 100);
  c.preview('p1', 1);
  guard = 0;
  while (c.update(0.1) && guard++ < 100);
  root.updateMatrixWorld(true);
  return animated(root);
}

test('un abattant pivote autour de l’axe horizontal du vantail', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [FLAP]);
  const node = openFully(c, root);
  // Vantail 90 × 6 × 200, hauteur en Z : l'axe horizontal est X.
  assert.ok(Math.abs(Math.abs(node.rotation.x) - Math.PI / 2) < 1e-6, 'l’angle est respecté');
  assert.equal(node.rotation.z, 0, 'pas de rotation verticale');
});

test('un abattant ouvert en bas se rabat sans quitter son arête basse', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [FLAP]);
  root.updateMatrixWorld(true);
  const closed = c.boxOf('p1');
  openFully(c, root);
  const opened = c.boxOf('p1');

  // À plat, seule la demi-épaisseur (3) dépasse sous le gond.
  assert.ok(Math.abs(opened.min.z - (closed.min.z - 3)) < 1e-3, 'le bas reste au niveau du gond');
  assert.ok(opened.max.z < closed.min.z + 10, 'le vantail est rabattu à plat, au ras du bas');
  assert.ok(Math.abs(opened.max.x - closed.max.x) < 1e-3 && Math.abs(opened.min.x - closed.min.x) < 1e-3,
    'la largeur ne bouge pas : l’axe court le long du vantail');
});

test('un abattant ouvert en haut se relève sous son arête haute', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [{ ...FLAP, hinge: 'end' }]);
  root.updateMatrixWorld(true);
  const closed = c.boxOf('p1');
  openFully(c, root);
  const opened = c.boxOf('p1');
  assert.ok(opened.min.z > closed.max.z - 10, 'le vantail est relevé à plat, au ras du haut');
});

test('le gond d’un abattant reste immobile', () => {
  for (const hinge of ['start', 'end']) {
    const root = model();
    const c = new PartController();
    c.build(root, [{ ...FLAP, hinge }]);
    root.updateMatrixWorld(true);
    const node = animated(root);
    const closed = node.localToWorld(new THREE.Vector3(0, 0, 0));
    openFully(c, root);
    const opened = node.localToWorld(new THREE.Vector3(0, 0, 0));
    assert.ok(closed.distanceTo(opened) < 1e-6, `gonds ${hinge} : le pivot ne se déplace jamais`);
    assert.ok(Math.abs(closed.z - (hinge === 'start' ? -100 : 100)) < 1e-6,
      'le pivot est sur l’arête basse ou haute');
  }
});

test('swingSide inverse aussi le sens d’un abattant', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [FLAP]);
  const front = openFully(c, root).rotation.x;
  c.configure({ ...FLAP, swingSide: 'back' });
  const back = openFully(c, root).rotation.x;
  assert.ok(Math.abs(front + back) < 1e-6);
});

test('changer d’axe se fait sans reconstruction', () => {
  const root = model();
  const c = new PartController();
  c.build(root, [DOOR]);
  const leaf = animated(root).children[0];
  const geometryBefore = leaf.geometry;
  const trisBefore = root.children[0].geometry.getIndex().count;

  assert.equal(c.configure({ ...FLAP, angle: 60 }), true);
  let node = openFully(c, root);
  assert.ok(Math.abs(Math.abs(node.rotation.x) - Math.PI / 3) < 1e-6, 'l’abattant prend l’angle demandé');
  assert.equal(node.rotation.z, 0);

  c.configure(DOOR);
  node = openFully(c, root);
  assert.equal(node.rotation.x, 0, 'retour à une porte : plus de rotation horizontale');
  assert.ok(Math.abs(Math.abs(node.rotation.z) - Math.PI / 2) < 1e-6);
  assert.equal(leaf.geometry, geometryBefore, 'la géométrie n’est pas retouchée');
  assert.equal(root.children[0].geometry.getIndex().count, trisBefore);
});

test('l’abattant suit la verticale du modèle, pas le plus grand axe', () => {
  // Un four plus large que haut : 90 de large en X, 60 de haut en Z. Sans la
  // verticale du modèle, l'axe de rotation serait pris sur la hauteur.
  const oven = boxGeom([0, 0, 0], [90, 6, 60]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(oven.p), 3));
  g.setIndex(oven.idx);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  mesh.name = 'MaisonHA';
  const root = new THREE.Group();
  root.add(mesh);

  const c = new PartController();
  c.setVertical(2);
  c.build(root, [FLAP]);
  root.updateMatrixWorld(true);
  const node = animated(root);
  const pivot = node.localToWorld(new THREE.Vector3(0, 0, 0));
  assert.ok(Math.abs(pivot.z + 30) < 1e-6, 'le gond est sur l’arête basse');
  openFully(c, root);
  assert.ok(Math.abs(Math.abs(node.rotation.x) - Math.PI / 2) < 1e-6, 'rotation autour de X, l’horizontale');
});

/**
 * Géométrie Z-up redressée par une rotation de nœud, comme un export qui
 * corrige son orientation au lieu de réécrire ses sommets : le monde est Y-up,
 * la maille reste Z-up. La carte déduit la verticale du monde (Y).
 */
function rotatedModel(angle = -Math.PI / 2) {
  const root = model();
  root.children[0].rotation.x = angle;
  root.updateMatrixWorld(true);
  return root;
}

test('régression : un abattant sur maille tournée ne retombe pas sur une porte', () => {
  const root = rotatedModel();
  const c = new PartController();
  c.setVertical(1);
  c.build(root, [FLAP]);
  const node = openFully(c, root);
  // Sans conversion, la verticale du monde (Y) tombait sur l'épaisseur locale
  // du vantail et l'abattant pivotait comme une porte, autour de Z.
  assert.equal(node.rotation.z, 0, 'pas de rotation autour de l’axe vertical local');
  assert.ok(Math.abs(Math.abs(node.rotation.x) - Math.PI / 2) < 1e-6);
});

test('sur maille tournée, « en bas » reste le bas du monde', () => {
  for (const [angle, label] of [[-Math.PI / 2, 'Z local vers le haut'], [Math.PI / 2, 'Z local vers le bas']]) {
    for (const hinge of ['start', 'end']) {
      const root = rotatedModel(angle);
      const c = new PartController();
      c.setVertical(1);
      c.build(root, [{ ...FLAP, hinge }]);
      root.updateMatrixWorld(true);
      const closed = c.boxOf('p1');
      const pivot = animated(root).localToWorld(new THREE.Vector3(0, 0, 0));
      const expected = hinge === 'start' ? closed.min.y : closed.max.y;
      assert.ok(Math.abs(pivot.y - expected) < 1e-6, `${label}, gonds ${hinge} : pivot sur la bonne arête`);
    }
  }
});

test('sur maille tournée, un volet descend vers le bas du monde', () => {
  for (const angle of [-Math.PI / 2, Math.PI / 2]) {
    const root = rotatedModel(angle);
    const c = new PartController();
    c.setVertical(1);
    c.build(root, [{ ...DOOR, motion: 'slide', slide: 'down', travel: 1 }]);
    root.updateMatrixWorld(true);
    const closed = c.boxOf('p1');
    openFully(c, root);
    const opened = c.boxOf('p1');
    assert.ok(Math.abs((closed.min.y - opened.min.y) - 200) < 1e-3, 'il descend de sa hauteur');
  }
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

test('dispose rend ses triangles à la maille', () => {
  const root = model();
  const mesh = root.children[0];
  const before = Array.from(mesh.geometry.getIndex().array);
  const c = new PartController();
  c.build(root, [DOOR]);
  assert.notDeepEqual(Array.from(mesh.geometry.getIndex().array), before);
  c.dispose(root);
  assert.deepEqual(Array.from(mesh.geometry.getIndex().array), before);
});

test('deux ouvrants d’une même maille détachent chacun leur pièce', () => {
  const root = model();
  const c = new PartController();
  // Triangle 12 : le premier du mur, dans la géométrie d'origine.
  const res = c.build(root, [DOOR, { ...DOOR, id: 'p2', triangle: 12 }]);
  assert.equal(res.ok, 2);
  const size = c.boxOf('p2').getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 400) < 1e-6, 'le second ouvrant est bien le mur');
});

// ── Ouvrant sur un nœud entier ──────────────────────────────────────────────

/**
 * Export Blender typique : chaque objet porte un quart de tour en X et une
 * échelle de 0,01 (géométrie Z-up en centimètres, monde Y-up en mètres). La
 * porte est un groupe de deux mailles — un objet à deux matériaux.
 */
function blenderModel() {
  const scene = new THREE.Group();
  const door = new THREE.Group();
  door.name = 'puerta_terraza';
  door.position.set(1, 0, -2);
  door.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  door.scale.setScalar(0.01);
  // Hauteur le long de -Z local, qui devient +Y dans le monde.
  for (const [i, c] of [[0, [45, 3, -100]], [1, [45, 3, -150]]]) {
    const b = boxGeom(c, i === 0 ? [90, 6, 200] : [20, 8, 10]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.p), 3));
    g.setIndex(b.idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    m.name = `puerta_terraza_${i + 1}`;
    door.add(m);
  }
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 2.5, 0.2), new THREE.MeshBasicMaterial());
  wall.name = 'wall_1';
  wall.position.set(4, 1.25, -2);
  scene.add(wall, door);
  scene.updateMatrixWorld(true);
  return { scene, door };
}

const NODE_DOOR = {
  id: 'n1', entity: 'binary_sensor.porte', mesh: 'puerta_terraza_1', meshIndex: 1, triangle: 0,
  node: 'puerta_terraza', nodeIndex: 1,
  motion: 'swing', hinge: 'start', angle: 90, duration: 1,
};

function worldVertices(obj) {
  obj.updateWorldMatrix(true, true);
  const out = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  });
  return out;
}

function settle(c, id, f) {
  c.preview(id, f);
  let guard = 0;
  while (c.update(0.1) && guard++ < 100);
}

test('un nœud entier se monte sans bouger à l’écran', () => {
  const { scene, door } = blenderModel();
  const before = worldVertices(door);
  const c = new PartController();
  c.setVertical(1);
  const res = c.build(scene, [NODE_DOOR]);
  assert.equal(res.ok, 1);
  assert.notEqual(door.parent, scene, 'le nœud est passé sous son pivot');
  const after = worldVertices(door);
  assert.equal(after.length, before.length, 'les deux mailles du groupe suivent');
  for (let i = 0; i < before.length; i++) assert.ok(after[i].distanceTo(before[i]) < 1e-9);
});

test('un nœud tourné pivote autour de la verticale du monde, gond immobile', () => {
  const { scene, door } = blenderModel();
  const before = worldVertices(door);
  const c = new PartController();
  c.setVertical(1);
  c.build(scene, [NODE_DOOR]);
  const pivot = c.objectOf('n1').parent.parent;
  const seat = pivot.getWorldPosition(new THREE.Vector3());

  settle(c, 'n1', 1);
  scene.updateMatrixWorld(true);
  const after = worldVertices(door);
  assert.ok(pivot.getWorldPosition(new THREE.Vector3()).distanceTo(seat) < 1e-9, 'le pivot ne bouge pas');
  assert.ok(Math.abs(Math.abs(pivot.rotation.y) - Math.PI / 2) < 1e-9, 'rotation autour de Y, la verticale du monde');
  let moved = 0;
  for (let i = 0; i < before.length; i++) {
    assert.ok(Math.abs(after[i].y - before[i].y) < 1e-9, 'la hauteur ne change pas');
    const r0 = Math.hypot(before[i].x - seat.x, before[i].z - seat.z);
    const r1 = Math.hypot(after[i].x - seat.x, after[i].z - seat.z);
    assert.ok(Math.abs(r0 - r1) < 1e-9, 'chaque point tourne autour du gond');
    if (after[i].distanceTo(before[i]) > 0.1) moved++;
  }
  assert.ok(moved > 0, 'la porte s’est ouverte');
  // Le gond est sur une arête verticale de la porte, pas en son milieu.
  const box = new THREE.Box3().setFromPoints(before);
  assert.ok(Math.abs(seat.x - box.min.x) < 1e-9 || Math.abs(seat.x - box.max.x) < 1e-9);
});

test('un nœud en abattant se rabat autour de son arête basse', () => {
  const { scene, door } = blenderModel();
  const closed = new THREE.Box3().setFromPoints(worldVertices(door));
  const c = new PartController();
  c.setVertical(1);
  c.build(scene, [{ ...NODE_DOOR, swingAxis: 'horizontal' }]);
  settle(c, 'n1', 1);
  const open = new THREE.Box3().setFromPoints(worldVertices(door));
  assert.ok(open.max.y - open.min.y < 0.1, 'couché à l’horizontale');
  assert.ok(Math.abs(open.min.y - closed.min.y) < 0.05, 'resté au ras de son arête basse');
});

test('un nœud coulisse vers le bas du monde', () => {
  const { scene, door } = blenderModel();
  const closed = new THREE.Box3().setFromPoints(worldVertices(door));
  const c = new PartController();
  c.setVertical(1);
  c.build(scene, [{ ...NODE_DOOR, motion: 'slide', slide: 'down', travel: 1 }]);
  settle(c, 'n1', 1);
  const open = new THREE.Box3().setFromPoints(worldVertices(door));
  assert.ok(Math.abs((closed.min.y - open.min.y) - 2) < 1e-6, 'il descend de sa hauteur, 2 m');
});

test('dispose remet le nœud à sa place, transformation comprise', () => {
  const { scene, door } = blenderModel();
  const position = door.position.clone();
  const c = new PartController();
  c.setVertical(1);
  c.build(scene, [NODE_DOOR]);
  settle(c, 'n1', 1);
  c.dispose(scene);
  assert.equal(door.parent, scene);
  assert.equal(scene.children.indexOf(door), 1, 'même rang parmi ses frères');
  assert.equal(scene.children.length, 2, 'aucun pivot oublié');
  assert.ok(door.position.distanceTo(position) < 1e-12);
});

test('les rangs survivent au montage : l’éditeur vise toujours le même nœud', () => {
  const { scene, door } = blenderModel();
  const meshesBefore = meshOrder(scene).map((m) => m.name);
  const c = new PartController();
  c.build(scene, [NODE_DOOR]);
  assert.deepEqual(meshOrder(scene).map((m) => m.name), meshesBefore);
  assert.equal(c.objectOf('n1'), door);
});

test('deux ouvrants sur le même nœud : le second est signalé', () => {
  const { scene } = blenderModel();
  const c = new PartController();
  const res = c.build(scene, [NODE_DOOR, { ...NODE_DOOR, id: 'n2' }]);
  assert.equal(res.ok, 1);
  assert.equal(res.missing[0].id, 'n2');
});

test('configure change de cible en direct, dans les deux sens', () => {
  const { scene, door } = blenderModel();
  const mesh = door.children[0];
  const pristine = Array.from(mesh.geometry.getIndex().array);
  const piece = { ...NODE_DOOR, node: undefined, nodeIndex: undefined };
  const c = new PartController();
  c.setVertical(1);
  c.build(scene, [piece]);
  assert.ok(c.hasTarget(piece));
  assert.notDeepEqual(Array.from(mesh.geometry.getIndex().array), pristine, 'pièce détachée');

  assert.equal(c.configure(NODE_DOOR), true);
  assert.ok(c.hasTarget(NODE_DOOR));
  assert.equal(c.objectOf('n1'), door);
  assert.deepEqual(Array.from(mesh.geometry.getIndex().array), pristine, 'la pièce est rendue à sa maille');

  assert.equal(c.configure(piece), true);
  assert.equal(door.parent, scene, 'le nœud est revenu sous la scène');
  assert.equal(c.count, 1);
});

test('une nouvelle cible introuvable laisse l’ancienne en place', () => {
  const { scene, door } = blenderModel();
  const c = new PartController();
  c.build(scene, [NODE_DOOR]);
  assert.equal(c.configure({ ...NODE_DOOR, node: 'inexistant', nodeIndex: 99 }), false);
  assert.equal(c.objectOf('n1'), door);
  assert.equal(c.count, 1);
});

test('un nœud introuvable est signalé comme manquant', () => {
  const { scene } = blenderModel();
  const c = new PartController();
  const res = c.build(scene, [{ ...NODE_DOOR, node: 'fantome', nodeIndex: 7 }]);
  assert.equal(res.ok, 0);
  assert.equal(res.missing.length, 1);
});

// ── Pièces choisies à la main ───────────────────────────────────────────────

/**
 * Modèle plat, comme un export réel : la porte dans une maille, la poignée
 * dans une autre qui en contient aussi une deuxième, loin de là.
 *
 * C'est la structure qui met en échec toute détection par parenté : rien, dans
 * le graphe, ne relie la poignée à sa porte.
 */
function modelAvecPoignees() {
  const root = model();
  const a = boxGeom([35, 0, 0], [10, 10, 4]);        // poignée de la porte
  const b = boxGeom([500, 0, 0], [10, 10, 4]);       // poignée d'ailleurs
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a.p, ...b.p]), 3));
  g.setIndex([...a.idx, ...b.idx.map((i) => i + 8)]);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  mesh.name = 'Poignees';
  root.add(mesh);
  return root;
}

const POIGNEE = { mesh: 'Poignees', meshIndex: 1, triangle: 0 };

function positionPoignee(root) {
  root.updateMatrixWorld(true);
  let found = null;
  root.traverse((o) => { if (!found && o.name.startsWith('Poignees#')) found = o; });
  return found ? found.getWorldPosition(new THREE.Vector3()) : null;
}

test('une pièce choisie à la main suit l’ouvrant', () => {
  const root = modelAvecPoignees();
  const c = new PartController();
  c.build(root, [{ ...DOOR, extra: [POIGNEE] }]);

  const ferme = positionPoignee(root);
  assert.ok(ferme, 'la poignée est détachée et montée sous le pivot');
  openFully(c, root);
  const ouvert = positionPoignee(root);
  assert.ok(ferme.distanceTo(ouvert) > 1, 'elle se déplace avec la porte');
});

test('sans pièce choisie, rien ne suit', () => {
  const root = modelAvecPoignees();
  const c = new PartController();
  c.build(root, [DOOR]);
  assert.equal(positionPoignee(root), null);
});

test('la pièce voisine de la même maille reste en place', () => {
  // Les deux poignées partagent une maille : seule celle qui est désignée
  // doit bouger, sinon l'autre traverserait le logement.
  const root = modelAvecPoignees();
  const c = new PartController();
  c.build(root, [{ ...DOOR, extra: [POIGNEE] }]);
  const autre = new THREE.Box3().setFromObject(root.children[1]);
  openFully(c, root);
  root.updateMatrixWorld(true);
  const apres = new THREE.Box3().setFromObject(root.children[1]);
  assert.ok(autre.min.distanceTo(apres.min) < 1e-6, 'la maille source ne bouge pas');
});

test('démonter rend la pièce à sa maille d’origine', () => {
  const root = modelAvecPoignees();
  const avant = root.children[1].geometry.getIndex().array.slice();
  const c = new PartController();
  c.build(root, [{ ...DOOR, extra: [POIGNEE] }]);
  c.dispose(root);
  assert.deepEqual(Array.from(root.children[1].geometry.getIndex().array), Array.from(avant));
  assert.equal(positionPoignee(root), null);
});

test('une pièce introuvable est ignorée sans casser le montage', () => {
  // Le modèle a pu changer depuis l'enregistrement de la scène.
  const root = modelAvecPoignees();
  const c = new PartController();
  const res = c.build(root, [{ ...DOOR, extra: [{ mesh: 'Disparue', triangle: 0 }] }]);
  assert.equal(res.ok, 1);
  assert.equal(res.missing.length, 0);
});

test('la pièce de l’ouvrant lui-même n’est pas reprise deux fois', () => {
  // L'extraire une seconde fois casserait la géométrie du vantail.
  const root = modelAvecPoignees();
  const c = new PartController();
  const res = c.build(root, [{ ...DOOR, extra: [{ mesh: 'MaisonHA', meshIndex: 0, triangle: 0 }] }]);
  assert.equal(res.ok, 1);
  const leaf = animated(root);
  assert.ok(leaf, 'le vantail est monté normalement');
});

test('ajouter une pièce en direct la fait suivre sans enregistrer', () => {
  // Le symptôme signalé : la pièce s'ajoutait à la configuration mais restait
  // en place, parce que `configure` reconfigure sans remonter.
  const root = modelAvecPoignees();
  const c = new PartController();
  c.build(root, [DOOR]);
  assert.equal(positionPoignee(root), null, 'rien ne suit au départ');

  assert.equal(c.configure({ ...DOOR, extra: [POIGNEE] }), true);
  const ferme = positionPoignee(root);
  assert.ok(ferme, 'la pièce est attachée dès la configuration');

  openFully(c, root);
  assert.ok(ferme.distanceTo(positionPoignee(root)) > 1, 'et elle suit le mouvement');
});

test('retirer une pièce en direct la remet en place', () => {
  const root = modelAvecPoignees();
  const c = new PartController();
  c.build(root, [{ ...DOOR, extra: [POIGNEE] }]);
  assert.ok(positionPoignee(root), 'elle est attachée');

  assert.equal(c.configure({ ...DOOR }), true);
  assert.equal(positionPoignee(root), null, 'elle est rendue à sa maille');
});

test('un réglage ordinaire ne remonte pas l’ouvrant', () => {
  // Le remontage coûte une extraction de géométrie : il ne doit avoir lieu
  // que lorsque les pièces changent, pas à chaque mouvement de curseur.
  const root = modelAvecPoignees();
  const c = new PartController();
  c.build(root, [{ ...DOOR, extra: [POIGNEE] }]);
  const avant = animated(root);
  c.configure({ ...DOOR, extra: [POIGNEE], angle: 45 });
  assert.equal(animated(root), avant, 'le même nœud animé est conservé');
});

test('la pièce ne bouge pas d’un pouce au montage', () => {
  // Le défaut signalé : elle suivait bien le mouvement, mais partait loin de la
  // porte. `_configure` déplace le pivot sur le gond et ne compense que le
  // vantail ; une pièce montée sur le pivot encaissait ce décalage.
  //
  // On mesure la boîte englobante et non la position de l'objet : c'est ce que
  // l'œil voit, et l'origine d'une pièce détachée n'est pas son centre.
  const root = modelAvecPoignees();
  const c = new PartController();
  c.build(root, [{ ...DOOR, extra: [POIGNEE] }]);
  root.updateMatrixWorld(true);

  let piece = null;
  root.traverse((o) => { if (!piece && o.name.startsWith('Poignees#')) piece = o; });
  const centre = new THREE.Box3().setFromObject(piece).getCenter(new THREE.Vector3());

  // La poignée désignée est modélisée centrée en (35, 0, 0).
  assert.ok(centre.distanceTo(new THREE.Vector3(35, 0, 0)) < 1e-6,
    `centre attendu (35, 0, 0), obtenu (${centre.toArray().map((v) => v.toFixed(2)).join(', ')})`);
});

test('la pièce reste solidaire du vantail pendant toute l’ouverture', () => {
  const root = modelAvecPoignees();
  const c = new PartController();
  c.build(root, [{ ...DOOR, extra: [POIGNEE] }]);

  const ecart = () => {
    root.updateMatrixWorld(true);
    const leaf = animated(root).children[0];
    return leaf.getWorldPosition(new THREE.Vector3()).distanceTo(positionPoignee(root));
  };
  const ferme = ecart();
  c.preview('p1', 0.5);
  for (let i = 0; i < 100 && c.update(0.1); i++);
  const mi = ecart();
  openFully(c, root);
  const ouvert = ecart();

  assert.ok(Math.abs(ferme - mi) < 1e-3, `écart constant à mi-course (${ferme} vs ${mi})`);
  assert.ok(Math.abs(ferme - ouvert) < 1e-3, `écart constant ouvert (${ferme} vs ${ouvert})`);
});

test('changer le côté des gonds n’éloigne pas la pièce', () => {
  // Le côté des gonds replace `object` : une pièce montée sur le pivot
  // deriverait a chaque bascule.
  const root = modelAvecPoignees();
  const c = new PartController();
  c.build(root, [{ ...DOOR, extra: [POIGNEE] }]);
  const avant = positionPoignee(root).clone();
  c.configure({ ...DOOR, extra: [POIGNEE], hinge: 'end' });
  const apres = positionPoignee(root);
  assert.ok(avant.distanceTo(apres) < 1e-3, `la pièce reste en place (${avant.distanceTo(apres)})`);
});

test('la teinte d’état s’applique aussi aux pièces entraînées', () => {
  // Signalé : seule la pièce principale prenait la couleur. La teinte relevait
  // ses mailles au premier placement, avant que les pièces soient attachées.
  const root = modelAvecPoignees();
  const source = root.children[1].material;
  const c = new PartController();
  c.build(root, [{ ...DOOR, extra: [POIGNEE], closedColor: '#ff0000' }]);

  let piece = null;
  root.traverse((o) => { if (!piece && o.name.startsWith('Poignees#')) piece = o; });
  assert.ok(piece, 'la poignée est montée');
  assert.notEqual(piece.material, source, 'la poignée porte une copie teintée, pas le matériau d’origine');
  assert.notEqual(piece.material.color.getHexString(), source.color.getHexString(), 'et sa couleur a changé');
});

test('la teinte suit une pièce ajoutée en direct', () => {
  const root = modelAvecPoignees();
  const source = root.children[1].material;
  const c = new PartController();
  c.build(root, [{ ...DOOR, closedColor: '#ff0000' }]);
  c.configure({ ...DOOR, extra: [POIGNEE], closedColor: '#ff0000' });

  let piece = null;
  root.traverse((o) => { if (!piece && o.name.startsWith('Poignees#')) piece = o; });
  assert.ok(piece && piece.material !== source, 'la poignée ajoutée après coup est teintée aussi');
});
