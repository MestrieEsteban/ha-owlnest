import test from 'node:test';
import assert from 'node:assert/strict';
import { planRooms, roomCamera, roomOfPoint } from './room-views.mjs';
import { addRect, reconcileRooms } from './graph.mjs';

const emptyPlan = () => ({ version: 2, wallHeight: 2.5, wallThickness: 0.15, nodes: [], walls: [], rooms: [], openings: [], items: [] });

function twoRooms() {
  const plan = emptyPlan();
  addRect(plan, 0, 0, 6, 4);
  addRect(plan, 6, 0, 9, 4);
  let n = 0;
  reconcileRooms(plan, () => `Pièce ${++n}`, () => '#ccc');
  return plan;
}

test('pièces : une par espace fermé, avec son nom et sa surface', () => {
  const rooms = planRooms(twoRooms());
  assert.equal(rooms.length, 2);
  const areas = rooms.map((r) => Math.round(r.area)).sort((a, b) => a - b);
  assert.deepEqual(areas, [12, 24]);
  assert.ok(rooms.every((r) => r.name.startsWith('Pièce')));
});

test('pièces : la plus grande d’abord, les homonymes numérotés', () => {
  const plan = emptyPlan();
  addRect(plan, 0, 0, 3, 3);
  addRect(plan, 3, 0, 9, 4);
  addRect(plan, 9, 0, 12, 3);
  reconcileRooms(plan, () => 'Chambre', () => '#ccc');
  const rooms = planRooms(plan);
  assert.equal(Math.round(rooms[0].area), 24);
  assert.deepEqual(rooms.map((r) => r.name).sort(), ['Chambre', 'Chambre 2', 'Chambre 3']);
});

test('pièces : un placard trop petit n’a pas de bouton', () => {
  const plan = emptyPlan();
  addRect(plan, 0, 0, 6, 4);
  addRect(plan, 6, 0, 7, 1);
  let n = 0;
  reconcileRooms(plan, () => `P${++n}`, () => '#ccc');
  assert.equal(planRooms(plan).length, 1);
});

test('caméra : visée au centre de la pièce, dans le repère de la scène', () => {
  const plan = twoRooms();
  const origin = { x: 4.5, y: 2 };
  const big = planRooms(plan).find((r) => Math.round(r.area) === 24);
  const pose = roomCamera(big, origin, { fovDeg: 45, aspect: 1.6, wallHeight: 2.5 });
  assert.ok(Math.abs(pose.target[0] - (3 - 4.5)) < 1e-6);
  assert.ok(Math.abs(pose.target[2] - (2 - 2)) < 1e-6);
  assert.equal(pose.target[1], 0);
  assert.ok(pose.pos[1] > 2.5, 'au-dessus des murs');
});

test('caméra : une grande pièce se regarde de plus loin, et jamais à moins de 3 m', () => {
  const plan = twoRooms();
  const rooms = planRooms(plan).sort((a, b) => a.area - b.area);
  const d = (r) => {
    const p = roomCamera(r, { x: 0, y: 0 }, { fovDeg: 45, aspect: 1.6, wallHeight: 2.5 });
    return Math.hypot(p.pos[0] - p.target[0], p.pos[1] - p.target[1], p.pos[2] - p.target[2]);
  };
  assert.ok(d(rooms[1]) > d(rooms[0]));
  assert.ok(d(rooms[0]) >= 3);
});

test('caméra : un panneau qui couvre la moitié de la carte éloigne la vue', () => {
  const room = planRooms(twoRooms())[0];
  const far = (visible) => {
    const p = roomCamera(room, { x: 0, y: 0 }, { fovDeg: 45, aspect: 1.6, wallHeight: 2.5, visible });
    return Math.hypot(p.pos[0] - p.target[0], p.pos[2] - p.target[2]);
  };
  assert.ok(far(0.5) > far(1));
});

test('point de la scène : retrouve sa pièce', () => {
  const plan = twoRooms();
  const rooms = planRooms(plan);
  const origin = { x: 4.5, y: 2 };
  // Le point (7.5, 2) du plan, soit (3, 0) dans la scène : la petite pièce.
  assert.equal(Math.round(roomOfPoint(rooms, origin, 3, 0).area), 12);
  assert.equal(Math.round(roomOfPoint(rooms, origin, -3, 0).area), 24);
  assert.equal(roomOfPoint(rooms, origin, 20, 0), null);
});
