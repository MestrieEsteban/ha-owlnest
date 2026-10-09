import test from 'node:test';
import assert from 'node:assert/strict';
import { wallsOf, wallFor, snapToWall, wallPieces, netArea, wallId } from './walls.mjs';

const plan = (rooms, extra = {}) => ({ version: 1, wallHeight: 2.5, wallThickness: 0.15, rooms, openings: [], ...extra });
const room = (id, x, y, w, d) => ({ id, name: id, x, y, w, d });

test('une pièce seule : quatre murs', () => {
  const walls = wallsOf(plan([room('a', 0, 0, 4, 3)]));
  assert.equal(walls.length, 4);
  assert.deepEqual(walls.map((w) => w.to - w.from).sort(), [3, 3, 4, 4]);
});

test('deux pièces côte à côte : le mur commun n’est créé qu’une fois', () => {
  const walls = wallsOf(plan([room('salon', 0, 0, 4, 3), room('cuisine', 4, 0, 3, 3)]));
  // Haut et bas fusionnés sur 7 m, gauche, droite, et un seul mur au milieu.
  assert.equal(walls.length, 5);
  const middle = walls.filter((w) => w.axis === 'y' && w.at === 4);
  assert.equal(middle.length, 1);
  const top = walls.find((w) => w.axis === 'x' && w.at === 0);
  assert.deepEqual([top.from, top.to], [0, 7]);
});

test('un bord partagé en partie seulement reste continu', () => {
  // Une chambre plus petite contre le salon : le mur commun couvre les deux.
  const walls = wallsOf(plan([room('salon', 0, 0, 4, 5), room('chambre', 4, 1, 3, 2)]));
  const shared = walls.filter((w) => w.axis === 'y' && w.at === 4);
  assert.deepEqual(shared.map((w) => [w.from, w.to]), [[0, 5]]);
});

test('réglage propre à un mur', () => {
  const id = wallId('x', 0, 0);
  const walls = wallsOf(plan([room('a', 0, 0, 4, 3)], { walls: { [id]: { height: 1.1, thickness: 0.3 } } }));
  const w = walls.find((x) => x.id === id);
  assert.equal(w.height, 1.1);
  assert.equal(w.thickness, 0.3);
});

test('une ouverture se rattache au mur le plus proche, si elle y tient', () => {
  const walls = wallsOf(plan([room('a', 0, 0, 4, 3)]));
  const door = { id: 'd', kind: 'door', x: 2, y: 3.05, width: 0.9, height: 2.04, sill: 0, hinge: 'start', swing: 'front' };
  const at = wallFor(door, walls);
  assert.equal(at.wall.axis, 'x');
  assert.equal(at.wall.at, 3);
  assert.equal(at.center, 2);
  assert.equal(wallFor({ ...door, width: 5 }, walls), null, 'trop large pour le mur');
});

test('poser une ouverture : on la cale sur le mur, sans dépasser', () => {
  const walls = wallsOf(plan([room('a', 0, 0, 4, 3)]));
  const p = snapToWall(3.7, 0.05, 1.2, walls);
  assert.deepEqual([p.x, p.y], [3.4, 0]);
  assert.equal(snapToWall(2, 1.5, 1, walls), null, 'au milieu de la pièce : aucun mur');
});

test('découpe d’un mur autour d’une porte et d’une fenêtre', () => {
  const wall = { id: 'w', axis: 'x', at: 0, from: 0, to: 6, height: 2.5, thickness: 0.15 };
  const pieces = wallPieces(wall, [
    { center: 1, width: 1, sill: 0, height: 2.0 },      // porte : linteau seulement
    { center: 4, width: 1.2, sill: 0.9, height: 1.2 },  // fenêtre : allège et linteau
  ]);
  assert.deepEqual(pieces.map((p) => [p.a, p.b, p.bottom, +p.top.toFixed(2)]), [
    [0, 0.5, 0, 2.5],
    [0.5, 1.5, 2, 2.5],
    [1.5, 3.4, 0, 2.5],
    [3.4, 4.6, 0, 0.9],
    [3.4, 4.6, 2.1, 2.5],
    [4.6, 6, 0, 2.5],
  ]);
});

test('surface entre les murs', () => {
  assert.equal(+netArea(room('a', 0, 0, 4, 3), 0.2).toFixed(2), 10.64);
});
