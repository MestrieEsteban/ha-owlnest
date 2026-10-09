import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addWall, addRect, removeWall, faces, reconcileRooms, splitWall, moveWall, cleanup, roomAtPoint, wallLength, openingPoint,
} from './graph.mjs';

const empty = () => ({ version: 2, wallHeight: 2.5, wallThickness: 0.15, nodes: [], walls: [], rooms: [], openings: [] });
let n = 0;
const names = () => `Pièce ${++n}`;
const floor = () => '#c9b08a';

test('un rectangle : quatre murs, une pièce', () => {
  const p = empty();
  addRect(p, 0, 0, 4, 3);
  assert.equal(p.walls.length, 4);
  const fs = faces(p);
  assert.equal(fs.length, 1);
  assert.equal(Math.round(fs[0].area), 12);
});

test('deux rectangles collés : un seul mur entre eux, deux pièces', () => {
  const p = empty();
  addRect(p, 0, 0, 4, 3);
  addRect(p, 4, 0, 7, 3);
  // 4 + 3 nouveaux murs : le mur commun n'est pas doublé.
  assert.equal(p.walls.length, 7);
  assert.equal(faces(p).length, 2);
});

test('une pièce plus petite contre une grande : le mur long est coupé en T', () => {
  const p = empty();
  addRect(p, 0, 0, 4, 5);
  addRect(p, 4, 1, 7, 3);
  assert.equal(faces(p).length, 2);
  // Le mur x = 4 est coupé aux deux jonctions : trois morceaux.
  const onLine = p.walls.filter((w) => {
    const a = p.nodes.find((q) => q.id === w.a), b = p.nodes.find((q) => q.id === w.b);
    return a.x === 4 && b.x === 4;
  });
  assert.equal(onLine.length, 3);
});

test('un mur qui traverse une pièce la coupe en deux', () => {
  const p = empty();
  addRect(p, 0, 0, 6, 4);
  addWall(p, { x: 3, y: -1 }, { x: 3, y: 5 });
  // Il dépasse dehors des deux côtés, mais sépare bien deux pièces.
  assert.equal(faces(p).length, 2);
});

test('une pièce en L, tracée mur par mur', () => {
  const p = empty();
  const pts = [[0, 0], [6, 0], [6, 2], [3, 2], [3, 5], [0, 5]];
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    addWall(p, { x: x1, y: y1 }, { x: x2, y: y2 });
  }
  const fs = faces(p);
  assert.equal(fs.length, 1);
  assert.equal(Math.round(fs[0].area), 21);
});

test('les pièces gardent leur nom, et fusionnent quand on retire le mur commun', () => {
  const p = empty();
  addRect(p, 0, 0, 4, 3);
  addRect(p, 4, 0, 7, 3);
  reconcileRooms(p, names, floor);
  assert.equal(p.rooms.length, 2);
  const salon = roomAtPoint(p, { x: 1, y: 1 });
  p.rooms.find((r) => r.id === salon.roomId).name = 'Salon';
  // On agrandit : les noms suivent.
  moveWall(p, p.walls.find((w) => {
    const a = p.nodes.find((q) => q.id === w.a), b = p.nodes.find((q) => q.id === w.b);
    return a.x === 7 && b.x === 7;
  }).id, { x: 1, y: 0 });
  reconcileRooms(p, names, floor);
  assert.deepEqual(p.rooms.map((r) => r.name).sort(), ['Pièce 1', 'Salon']);
  // Retirer le mur commun : une seule pièce reste.
  const shared = p.walls.find((w) => {
    const a = p.nodes.find((q) => q.id === w.a), b = p.nodes.find((q) => q.id === w.b);
    return a.x === 4 && b.x === 4;
  });
  removeWall(p, shared.id);
  reconcileRooms(p, names, floor);
  assert.equal(p.rooms.length, 1);
  // Les murs du haut et du bas redeviennent d'un seul tenant.
  assert.equal(p.walls.length, 4);
});

test('une ouverture suit son mur quand il est coupé', () => {
  const p = empty();
  addWall(p, { x: 0, y: 0 }, { x: 10, y: 0 });
  const w = p.walls[0];
  p.openings.push({ id: 'o', kind: 'door', wall: w.id, offset: 7, width: 0.9, height: 2, sill: 0, hinge: 'start', swing: 'front' });
  splitWall(p, w.id, { x: 4, y: 0 });
  const o = p.openings[0];
  assert.notEqual(o.wall, w.id);
  assert.equal(o.offset, 3);
  assert.deepEqual(openingPoint(p, o), { x: 7, y: 0 });
});

test('fusionner deux murs alignés garde la place des ouvertures', () => {
  const p = empty();
  addWall(p, { x: 0, y: 0 }, { x: 4, y: 0 });
  addWall(p, { x: 4, y: 0 }, { x: 10, y: 0 });
  assert.equal(p.walls.length, 2);
  const second = p.walls[1];
  p.openings.push({ id: 'o', kind: 'window', wall: second.id, offset: 3, width: 1, height: 1, sill: 1, hinge: 'start', swing: 'front' });
  cleanup(p);
  assert.equal(p.walls.length, 1);
  assert.equal(wallLength(p, p.walls[0]), 10);
  assert.deepEqual(openingPoint(p, p.openings[0]), { x: 7, y: 0 });
});

test('un coin lâché sur un mur s’y accroche, et la pièce se ferme', async () => {
  const { settle, moveNode } = await import('./graph.mjs');
  const p = empty();
  addRect(p, 0, 0, 4, 4);
  // Un mur qui part du haut et s'arrête un peu avant le bas.
  addWall(p, { x: 2, y: 0 }, { x: 2, y: 3 });
  assert.equal(faces(p).length, 1);
  const end = p.nodes.find((q) => q.x === 2 && q.y === 3);
  moveNode(p, end.id, { x: 2, y: 4 });
  settle(p);
  assert.equal(faces(p).length, 2);
});

test('un mur glissé à travers un autre le coupe', async () => {
  const { settle } = await import('./graph.mjs');
  const p = empty();
  addRect(p, 0, 0, 6, 4);
  addWall(p, { x: 8, y: 2 }, { x: 10, y: 2 });
  const free = p.walls.at(-1);
  moveWall(p, free.id, { x: -3, y: 0 });
  settle(p);
  // Le mur dépasse à droite, il coupe le côté x = 6 sans fermer de pièce de plus.
  assert.equal(faces(p).length, 1);
  assert.ok(p.nodes.some((q) => q.x === 6 && q.y === 2));
});

test('une pièce garde son nom quand on pousse un mur au-delà de sa graine', async () => {
  const { roomShapes, reseedRooms } = await import('./graph.mjs');
  const p = empty();
  addRect(p, 0, 0, 10, 4);
  reconcileRooms(p, () => 'Cuisine', floor);
  const right = p.walls.find((w) => {
    const a = p.nodes.find((q) => q.id === w.a), b = p.nodes.find((q) => q.id === w.b);
    return a.x === 10 && b.x === 10;
  });
  const shapes = roomShapes(p);
  moveWall(p, right.id, { x: -8, y: 0 });
  reseedRooms(p, shapes);
  reconcileRooms(p, () => 'Nouvelle', floor);
  assert.deepEqual(p.rooms.map((r) => r.name), ['Cuisine']);
});

test('recollage : un mur qui s’arrête 10 cm avant un autre le rejoint, et la pièce se ferme', async () => {
  const { closeGaps } = await import('./graph.mjs');
  const p = empty();
  addWall(p, { x: 0, y: 0 }, { x: 4, y: 0 });
  addWall(p, { x: 4, y: 0 }, { x: 4, y: 3 });
  addWall(p, { x: 4, y: 3 }, { x: 0, y: 3 });
  // Le dernier mur s'arrête à 20 cm du premier.
  addWall(p, { x: 0, y: 3 }, { x: 0, y: 0.2 });
  assert.equal(faces(p).length, 0);
  assert.ok(closeGaps(p) >= 1);
  assert.equal(faces(p).length, 1);
});

test('recollage : deux murs parallèles (un mur doublé) ne sont pas reliés', async () => {
  const { closeGaps } = await import('./graph.mjs');
  const p = empty();
  addWall(p, { x: 0, y: 0 }, { x: 4, y: 0 });
  addWall(p, { x: 0, y: 0.2 }, { x: 4, y: 0.2 });
  assert.equal(closeGaps(p), 0);
  assert.equal(p.walls.length, 2);
});
