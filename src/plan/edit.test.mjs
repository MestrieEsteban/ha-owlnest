import test from 'node:test';
import assert from 'node:assert/strict';
import { snapTo, roomFromDrag, moveRoom, resizeRoom, roomAt, calibrate, nextRoomName } from './edit.mjs';

const room = (id, x, y, w, d, name = id) => ({ id, name, x, y, w, d });

test('aimant : un bord voisin l’emporte sur la grille', () => {
  assert.equal(snapTo(4.08, [4]), 4);
  assert.equal(snapTo(4.32, [4]), 4.3, 'trop loin : la grille de 5 cm');
});

test('tracer une pièce collée à une autre : le mur est partagé au millimètre', () => {
  const salon = room('a', 0, 0, 4, 3);
  const r = roomFromDrag(4.1, -0.07, 6.97, 3.12, [salon]);
  assert.deepEqual(r, { x: 4, y: 0, w: 2.95, d: 3 });
});

test('déplacer une pièce contre sa voisine', () => {
  const a = room('a', 0, 0, 4, 3);
  const b = room('b', 6, 0, 2, 3);
  // On la tire à 10 cm de la voisine : elle s'y colle.
  assert.deepEqual(moveRoom(b, -1.9, 0.02, [a, b]), { x: 4, y: 0 });
});

test('redimensionner par un coin, avec une taille minimale', () => {
  const a = room('a', 0, 0, 4, 3);
  assert.deepEqual(resizeRoom(a, 'se', 5.02, 3.98, [a]), { x: 0, y: 0, w: 5, d: 4 });
  assert.deepEqual(resizeRoom(a, 'w', 3.9, 0, [a]), { x: 3.5, y: 0, w: 0.5, d: 3 });
});

test('la plus petite pièce gagne quand on clique un chevauchement', () => {
  const big = room('big', 0, 0, 10, 10), small = room('small', 2, 2, 2, 2);
  assert.equal(roomAt([big, small], 3, 3).id, 'small');
  assert.equal(roomAt([big, small], 12, 3), null);
});

test('mettre une image à l’échelle autour du premier point', () => {
  // On a mesuré 2 m sur l'image entre deux murs qui en font 4 en vrai.
  assert.deepEqual(calibrate({ x: 0, y: 0, width: 10 }, 1, 1, 2, 4), { x: -1, y: -1, width: 20 });
});

test('nom de pièce sans doublon', () => {
  assert.equal(nextRoomName([room('a', 0, 0, 1, 1, 'Pièce 2')], 'Pièce'), 'Pièce 3');
});
