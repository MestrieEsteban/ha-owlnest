import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  stampOrder, nodeOrder, resolveNode, normalizeName, filterOutline, ancestorsOf,
  locatePart, revealRanks, outlineRows, centredScrollTop, PIECE_ROW,
} from './model-outline.mjs';

function mesh(name, tris = 12) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris * 9), 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ name: `${name}_mat` }));
  m.name = name;
  return m;
}

function group(name, ...children) {
  const g = new THREE.Group();
  g.name = name;
  g.add(...children);
  return g;
}

/**
 * Forme du modèle réel : des centaines d'objets à plat, quelques vrais
 * groupes, et les objets multi-matériaux en groupes de mailles.
 */
function house() {
  const root = new THREE.Group();
  root.add(
    mesh('wall_1'),
    group('puerta_terraza', mesh('puerta_terraza_1', 4), mesh('puerta_terraza_2', 2)),
    group('Top_Desk_Section', mesh('Upper_Legs_Half'), group('Desk', mesh('DESK_final'))),
    mesh('puerta_lavaplatos', 3),
    mesh('Ventana_Salón'),
  );
  return root;
}

test('stampOrder numérote comme traverse et compte les triangles des groupes', () => {
  const root = house();
  const o = stampOrder(root);
  const names = [];
  root.traverse((n) => { if (n !== root) names.push(n.name); });
  assert.deepEqual(o.byRank.map((n) => n.name), names);
  assert.equal(o.roots.length, 5);
  const door = o.byRank.find((n) => n.name === 'puerta_terraza');
  assert.equal(door.tris, 6, 'un groupe cumule ses mailles');
  assert.equal(door.meshRank, -1);
  assert.equal(o.byRank.find((n) => n.name === 'puerta_terraza_2').material, 'puerta_terraza_2_mat');
});

test('les rangs ne bougent plus une fois posés', () => {
  const root = house();
  stampOrder(root);
  const door = root.children[1];
  // La carte loge un nœud animé sous un pivot ajouté en fin de liste.
  const pivot = new THREE.Group();
  pivot.userData.owlnestPartId = 'p';
  root.add(pivot);
  pivot.add(door);
  const order = nodeOrder(root);
  assert.equal(order[1], door, 'le nœud garde son rang');
  assert.ok(!order.includes(pivot), 'le pivot de la carte n’a pas de rang');
  assert.equal(stampOrder(root).byRank.length, 10, 'l’arborescence reste celle du fichier');
});

test('resolveNode : le rang départage des homonymes, le nom arbitre', () => {
  const root = new THREE.Group();
  root.add(mesh('porte'), mesh('porte'), mesh('garage'));
  const order = nodeOrder(root);
  assert.equal(resolveNode(order, { node: 'porte', nodeIndex: 1 }), order[1]);
  assert.equal(resolveNode(order, { node: 'porte', nodeIndex: 2 }), order[0], 'rang sur un autre nom : repli par nom');
  assert.equal(resolveNode(order, { node: 'porte', nodeIndex: 42 }), order[0], 'rang hors limites : repli par nom');
  assert.equal(resolveNode(order, { node: 'fenetre' }), null);
});

test('normalizeName rapproche les noms Blender de ce qu’on tape', () => {
  assert.equal(normalizeName('puerta_terraza'), 'puerta terraza');
  assert.equal(normalizeName('Ventana_Salón.001'), 'ventana salon 001');
});

test('le filtre garde les correspondances et leurs ancêtres, dépliés', () => {
  const o = stampOrder(house());
  const f = filterOutline(o, 'desk');
  const names = (set) => [...set].map((r) => o.byRank[r].name).sort();
  assert.deepEqual(names(f.matches), ['DESK_final', 'Desk', 'Top_Desk_Section']);
  assert.ok(names(f.expand).includes('Top_Desk_Section'));
  assert.ok(!f.visible.has(o.byRank.find((n) => n.name === 'wall_1').rank));
});

test('le filtre exige tous les mots, dans n’importe quel ordre', () => {
  const o = stampOrder(house());
  const f = filterOutline(o, 'terraza puerta');
  const names = [...f.matches].map((r) => o.byRank[r].name).sort();
  assert.deepEqual(names, ['puerta_terraza', 'puerta_terraza_1', 'puerta_terraza_2']);
  assert.equal(filterOutline(o, 'salon').matches.size, 1, 'sans accent, on trouve « Salón »');
});

test('le contenu d’une correspondance reste accessible, sans être déplié', () => {
  const o = stampOrder(house());
  const f = filterOutline(o, 'top section');
  const top = o.byRank.find((n) => n.name === 'Top_Desk_Section');
  assert.ok(!f.expand.has(top.rank), 'la correspondance elle-même reste repliée');
  assert.ok(f.visible.has(o.byRank.find((n) => n.name === 'DESK_final').rank));
  const rows = outlineRows(o, new Set([top.rank]), f);
  assert.deepEqual(rows.map((r) => r.node.name), ['Top_Desk_Section', 'Upper_Legs_Half', 'Desk']);
});

test('outlineRows ne livre que le contenu déplié, avec la profondeur', () => {
  const o = stampOrder(house());
  const none = filterOutline(o, '');
  assert.equal(none.visible, null);
  assert.equal(outlineRows(o, new Set(), none).length, 5, 'tout replié : la racine seule');
  const desk = o.byRank.find((n) => n.name === 'Desk');
  const top = o.byRank.find((n) => n.name === 'Top_Desk_Section');
  const rows = outlineRows(o, new Set([top.rank, desk.rank]), none);
  assert.equal(rows.find((r) => r.node?.name === 'DESK_final').depth, 2);
  assert.equal(rows.find((r) => r.rank === top.rank).open, true);
  assert.equal(rows.find((r) => r.node?.name === 'wall_1').hasKids, false);
});

/** Comme l'export réel : les portes rangées après des centaines de murs. */
function bigHouse() {
  const root = new THREE.Group();
  for (let i = 0; i < 700; i++) root.add(mesh(`wall_${i}`));
  root.add(group('puerta_terraza', mesh('504', 4), mesh('504_1', 2)));
  root.add(mesh('puerta_lavaplatos', 3));
  return root;
}

test('outlineRows n’a pas de plafond : un objet au-delà de 400 lignes est atteignable', () => {
  const o = stampOrder(bigHouse());
  const rows = outlineRows(o, new Set(), filterOutline(o, ''));
  assert.equal(rows.length, 702);
  assert.equal(rows.findIndex((r) => r.node?.name === 'puerta_lavaplatos'), 701);
});

test('locatePart : la maille par son rang de maille si le nom concorde, sinon par nom', () => {
  const root = bigHouse();
  const o = stampOrder(root);
  const door = o.byRank.find((n) => n.name === 'puerta_lavaplatos');
  assert.equal(locatePart(o, { mesh: 'puerta_lavaplatos', meshIndex: door.meshRank }).seed, door);
  assert.equal(locatePart(o, { mesh: 'puerta_lavaplatos', meshIndex: 3 }).seed, door, 'rang d’un autre nom : repli par nom');
  assert.equal(locatePart(o, { mesh: 'puerta_lavaplatos', meshIndex: -1 }).seed, door, 'rang inconnu : par nom');
  assert.equal(locatePart(o, { mesh: 'puerta_lavaplatos' }).selected, null, 'sans nœud : la pièce cliquée');
  assert.equal(locatePart(o, { mesh: 'absente' }).seed, null);
});

test('locatePart : un groupe n’est jamais pris pour la maille cliquée', () => {
  const o = stampOrder(bigHouse());
  assert.equal(locatePart(o, { mesh: 'puerta_terraza' }).seed, null);
});

test('locatePart : le nœud par son rang si le nom concorde, sinon par nom', () => {
  const o = stampOrder(bigHouse());
  const grp = o.byRank.find((n) => n.name === 'puerta_terraza');
  const cfg = { mesh: '504', meshIndex: o.byRank.find((n) => n.name === '504').meshRank, node: 'puerta_terraza' };
  assert.equal(locatePart(o, { ...cfg, nodeIndex: grp.rank }).selected, grp.rank);
  assert.equal(locatePart(o, { ...cfg, nodeIndex: 0 }).selected, grp.rank, 'fichier réexporté : le nom arbitre');
  assert.equal(locatePart(o, { ...cfg, node: 'disparu', nodeIndex: 0 }).selected, null);
});

test('revealRanks déplie les ancêtres de la cible et la maille qui porte la pièce', () => {
  const o = stampOrder(house());
  const leaf = o.byRank.find((n) => n.name === 'DESK_final');
  const names = (ranks) => ranks.map((r) => o.byRank[r].name).sort();
  const piece = locatePart(o, { mesh: 'DESK_final' });
  assert.deepEqual(names(revealRanks(o, piece)), ['DESK_final', 'Desk', 'Top_Desk_Section']);
  const node = { selected: leaf.parent.rank, seed: null };
  assert.deepEqual(names(revealRanks(o, node)), ['Top_Desk_Section'], 'le nœud choisi reste replié');
});

test('la pièce cliquée s’insère sous sa maille, une fois celle-ci dépliée', () => {
  const o = stampOrder(bigHouse());
  const loc = locatePart(o, { mesh: 'puerta_lavaplatos' });
  const rows = outlineRows(o, new Set(revealRanks(o, loc)), filterOutline(o, ''), loc.seed);
  const at = rows.findIndex((r) => r.rank === PIECE_ROW);
  assert.equal(at, 702, 'juste après sa maille, en 702e ligne');
  assert.equal(rows[at - 1].node, loc.seed);
  assert.equal(rows[at].depth, 1);
  assert.equal(outlineRows(o, new Set(), filterOutline(o, ''), loc.seed).some((r) => r.rank === PIECE_ROW), false,
    'maille repliée : pas de pièce');
});

test('une cible dans un groupe : ses ancêtres dépliés, sa ligne présente', () => {
  const o = stampOrder(bigHouse());
  const loc = locatePart(o, { mesh: '504_1' });
  const rows = outlineRows(o, new Set(revealRanks(o, loc)), filterOutline(o, ''), loc.seed);
  const names = rows.slice(700).map((r) => r.node?.name ?? '◆');
  assert.deepEqual(names, ['puerta_terraza', '504', '504_1', '◆', 'puerta_lavaplatos']);
});

test('centredScrollTop centre la ligne sans dépasser les bords', () => {
  assert.equal(centredScrollTop(0, 20, 200, 1000), 0, 'en tête : pas de défilement négatif');
  assert.equal(centredScrollTop(500, 20, 200, 1000), 500 * 20 - 90, 'au milieu : centrée');
  assert.equal(centredScrollTop(999, 20, 200, 1000), 1000 * 20 - 200, 'en fin : la dernière ligne au bas');
  assert.equal(centredScrollTop(3, 20, 200, 5), 0, 'liste plus courte que la vue');
});

test('ancestorsOf remonte du plus proche au plus lointain', () => {
  const o = stampOrder(house());
  const leaf = o.byRank.find((n) => n.name === 'DESK_final');
  assert.deepEqual(ancestorsOf(o, leaf.rank).map((r) => o.byRank[r].name), ['Desk', 'Top_Desk_Section']);
});
