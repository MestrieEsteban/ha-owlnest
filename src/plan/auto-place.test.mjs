import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, matchRooms, placeable, spreadPoints } from './auto-place.mjs';

test('noms : accents, majuscules et espaces ne comptent pas', () => {
  assert.equal(normalizeName('  Salle à Manger '), 'salle a manger');
  assert.equal(normalizeName('Chambre_d’amis'), 'chambre d amis');
});

test('pièces : appariées par leur nom', () => {
  const m = matchRooms(
    [{ id: 'r1', name: 'Salon' }, { id: 'r2', name: 'Cuisine' }, { id: 'r3', name: 'Pièce 3' }],
    [{ id: 'a1', name: 'salon' }, { id: 'a2', name: 'Cuisine ' }, { id: 'a3', name: 'Garage' }],
  );
  assert.deepEqual([...m.entries()], [['r1', 'a1'], ['r2', 'a2']]);
});

test('appareils : ce qui se regarde ou se commande, pas les capteurs techniques', () => {
  assert.equal(placeable('light.salon'), true);
  assert.equal(placeable('sensor.temp', { device_class: 'temperature' }), true);
  assert.equal(placeable('sensor.batterie', { device_class: 'battery' }), false);
  assert.equal(placeable('binary_sensor.porte', { device_class: 'door' }), true);
  assert.equal(placeable('binary_sensor.maj', { device_class: 'update' }), false);
  assert.equal(placeable('automation.matin'), false);
});

test('répartition : des points distincts, tous dans la pièce et loin des murs', () => {
  const poly = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 }];
  const pts = spreadPoints(poly, 5);
  assert.equal(pts.length, 5);
  assert.equal(new Set(pts.map((p) => `${p.x},${p.y}`)).size, 5);
  for (const p of pts) assert.ok(p.x >= 0.5 && p.x <= 5.5 && p.y >= 0.5 && p.y <= 3.5, JSON.stringify(p));
});

test('répartition : une pièce en L garde ses points dedans', () => {
  const L = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 6 }, { x: 0, y: 6 }];
  for (const p of spreadPoints(L, 4)) assert.ok(!(p.x > 2 && p.y > 2), JSON.stringify(p));
});
