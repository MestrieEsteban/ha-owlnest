import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildPlan, leafName } from './build.mjs';
import { addRect, addWall, reconcileRooms } from './graph.mjs';
import { migratePlan } from './migrate.mjs';

const room = (x0 = 0, y0 = 0, x1 = 4, y1 = 3) => {
  const p = { version: 2, wallHeight: 2.5, wallThickness: 0.2, nodes: [], walls: [], rooms: [], openings: [] };
  addRect(p, x0, y0, x1, y1);
  reconcileRooms(p, () => 'Salon', () => '#c9b08a');
  return p;
};
const wallOn = (p, test) => p.walls.find((w) => {
  const a = p.nodes.find((n) => n.id === w.a), b = p.nodes.find((n) => n.id === w.b);
  return test(a, b);
});
const boxOf = (o) => new THREE.Box3().setFromObject(o);
// Un bloc de mur peut avoir plusieurs faces colorées (wall_i_k_1, …) : on compte les blocs.
const walls = (root) => {
  const blocks = new Map();
  for (const c of root.children) {
    const m = /^wall_(\d+)_(\d+)/.exec(c.name);
    if (!m) continue;
    const key = `${m[1]}_${m[2]}`;
    const box = blocks.get(key) ?? new THREE.Box3();
    box.union(new THREE.Box3().setFromObject(c));
    blocks.set(key, box);
  }
  return [...blocks.values()].map((box) => ({ box }));
};

test('une pièce : un sol et des murs à la bonne hauteur', () => {
  const p = room();
  const root = buildPlan(p);
  assert.ok(root.getObjectByName(`room_${p.rooms[0].id}`));
  assert.equal(walls(root).length, 4);
  assert.ok(Math.abs(boxOf(root).max.y - 2.5) < 0.01);
});

test('les angles sont fermés : la maison fait la taille des murs, épaisseur comprise', () => {
  const root = buildPlan(room());
  const b = boxOf(root);
  assert.ok(Math.abs(b.min.x + 0.1) < 1e-3 && Math.abs(b.max.x - 4.1) < 1e-3);
  assert.ok(Math.abs(b.min.z + 0.1) < 1e-3 && Math.abs(b.max.z - 3.1) < 1e-3);
});

test('un muret garde sa propre hauteur', () => {
  const p = room();
  wallOn(p, (a, b) => a.x === 0 && b.x === 0).height = 1.1;
  const low = walls(buildPlan(p)).filter((c) => c.box.max.y < 1.2);
  assert.equal(low.length, 1);
});

test('une porte : le mur est ouvert, et le vantail porte ses gonds', () => {
  const p = room();
  const w = wallOn(p, (a, b) => a.y === 3 && b.y === 3);
  p.openings.push({ id: 'd', kind: 'door', wall: w.id, offset: 2, width: 0.9, height: 2, sill: 0, hinge: 'end', swing: 'back' });
  const root = buildPlan(p);
  // Le mur du bas est coupé en trois : avant, linteau, après.
  const bottom = walls(root).filter((c) => Math.abs(c.box.getCenter(new THREE.Vector3()).z - 3) < 0.01);
  assert.equal(bottom.length, 3);
  root.updateMatrixWorld(true);
  const leaf = root.getObjectByName(leafName('d', 1));
  assert.equal(leaf.userData.owlnestLeaf.hinge, 'end');
  assert.equal(leaf.userData.owlnestLeaf.motion, 'hinge');
  // La porte est bien au milieu du mur.
  const c = boxOf(leaf).getCenter(new THREE.Vector3());
  assert.ok(Math.abs(c.x - 2) < 0.05 && Math.abs(c.z - 3) < 0.05);
});

test('une ouverture qui ne tient pas sur son mur est ignorée sans casser le reste', () => {
  const p = room();
  p.openings.push({ id: 'x', kind: 'window', wall: p.walls[0].id, offset: 30, width: 1, height: 1, sill: 1, hinge: 'start', swing: 'front' });
  const root = buildPlan(p);
  assert.equal(root.getObjectByName(leafName('x', 1)), undefined);
  assert.equal(walls(root).length, 4);
});

test('une baie coulissante : un panneau fixe, un panneau mobile ; un passage : aucun', () => {
  const p = room();
  p.openings.push(
    { id: 's', kind: 'slider', wall: p.walls[0].id, offset: 2, width: 2, height: 2.1, sill: 0, hinge: 'start', swing: 'front' },
    { id: 'g', kind: 'passage', wall: p.walls[1].id, offset: 1.5, width: 0.9, height: 2.1, sill: 0, hinge: 'start', swing: 'front' },
  );
  const root = buildPlan(p);
  assert.equal(root.getObjectByName(leafName('s', 1)).userData.owlnestLeaf, undefined);
  assert.equal(root.getObjectByName(leafName('s', 2)).userData.owlnestLeaf.motion, 'rail');
  assert.ok(root.getObjectByName('plan_opening_g'));
  assert.equal(root.getObjectByName(leafName('g', 1)), undefined);
});

test('une pièce en L a un sol en L', () => {
  const p = { version: 2, wallHeight: 2.5, wallThickness: 0.2, nodes: [], walls: [], rooms: [], openings: [] };
  const pts = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 5], [0, 5]];
  pts.forEach(([x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; addWall(p, { x, y }, { x: u, y: v }); });
  reconcileRooms(p, () => 'L', () => '#ccc');
  const floor = buildPlan(p).getObjectByName(`room_${p.rooms[0].id}`);
  // Surface du dessus : 21 m².
  const pos = floor.geometry.getAttribute('position');
  let top = 0;
  for (let i = 0; i < pos.count; i += 3) {
    if (pos.getY(i) !== 0 || pos.getY(i + 1) !== 0 || pos.getY(i + 2) !== 0) continue;
    const ax = pos.getX(i), az = pos.getZ(i);
    top += Math.abs((pos.getX(i + 1) - ax) * (pos.getZ(i + 2) - az) - (pos.getX(i + 2) - ax) * (pos.getZ(i + 1) - az)) / 2;
  }
  assert.ok(Math.abs(top - 21) < 1e-6);
});

test("un plan de la première version de l'éditeur est converti", () => {
  const p = migratePlan({
    version: 1, wallHeight: 2.5, wallThickness: 0.2,
    rooms: [
      { id: 'a', name: 'Salon', x: 0, y: 0, w: 4, d: 3 },
      { id: 'b', name: 'Chambre', x: 4, y: 0, w: 3, d: 3 },
    ],
    openings: [{ id: 'd', kind: 'door', x: 4, y: 1.5, width: 0.8, height: 2, sill: 0, hinge: 'start', swing: 'front' }],
  });
  assert.equal(p.version, 2);
  assert.equal(p.walls.length, 7);
  assert.deepEqual(p.rooms.map((r) => r.name).sort(), ['Chambre', 'Salon']);
  assert.equal(p.openings.length, 1);
  assert.ok(Math.abs(p.openings[0].offset - 1.5) < 1e-6);
});

test('chaque face de mur prend la couleur de la pièce qu’elle regarde', () => {
  const p = room();
  p.rooms[0].wall = '#ff0000';
  p.outside = '#00ff00';
  const root = buildPlan(p);
  const colors = new Set();
  root.traverse((o) => { if (o.isMesh && o.name.startsWith('wall_')) colors.add(`#${o.material.color.getHexString()}`); });
  assert.ok(colors.has('#ff0000') && colors.has('#00ff00'));
});

test('portes à panneaux, vitrée, d’entrée ; fenêtre à petits bois', () => {
  const p = room();
  const w = p.walls[0].id;
  p.openings.push(
    { id: 'a', kind: 'door', wall: w, offset: 1, width: 0.8, height: 2, sill: 0, hinge: 'start', swing: 'front', style: 'panels', color: '#ffffff' },
    { id: 'b', kind: 'door', wall: w, offset: 3, width: 0.8, height: 2, sill: 0, hinge: 'start', swing: 'front', style: 'glazed' },
    { id: 'c', kind: 'window', wall: p.walls[1].id, offset: 1.5, width: 1, height: 1, sill: 1, hinge: 'start', swing: 'front', style: 'grid' },
  );
  const root = buildPlan(p);
  assert.ok(root.getObjectByName(`${leafName('a', 1)}_panel_f0`));
  assert.ok(root.getObjectByName(`${leafName('b', 1)}_pane`));
  assert.equal(root.getObjectByName(leafName('b', 1)).userData.owlnestLeaf.pane, true);
  assert.ok(root.getObjectByName(`${leafName('c', 1)}_muntin_v`));
});
