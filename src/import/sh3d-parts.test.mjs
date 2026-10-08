import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceParts, leafKind } from './sh3d-parts.mjs';

const part = (o) => ({ id: 'x', entity: '', mesh: 'm', triangle: 0, motion: 'swing', ...o });

test('remplacer garde capteur et réglages du même vantail, et oublie les anciens', () => {
  const existing = [
    part({ id: 'old1', node: 'sweethome3d_leaf_0_1', nodeIndex: 3, entity: 'binary_sensor.porte', swingSide: 'back', label: 'Entrée' }),
    part({ id: 'old2', mesh: 'Porte_ancien_modele', entity: 'binary_sensor.garage' }),
  ];
  const detected = [
    part({ id: 'new1', node: 'sweethome3d_leaf_0_1', nodeIndex: 7, mesh: 'door_71', label: 'Porte 1' }),
    part({ id: 'new2', node: 'sweethome3d_leaf_1_1', nodeIndex: 9, label: 'Fenêtre 1' }),
  ];
  const out = replaceParts(existing, detected);
  assert.equal(out.length, 2, "l'ouvrant de l'ancien modèle disparaît");
  assert.deepEqual(
    [out[0].id, out[0].entity, out[0].swingSide, out[0].label, out[0].nodeIndex, out[0].mesh],
    ['old1', 'binary_sensor.porte', 'back', 'Entrée', 7, 'door_71'],
  );
  assert.equal(out[1].id, 'new2');
});

test('une porte de placard reste un meuble', () => {
  const info = (size, pane = false) => ({ motion: 'hinge', hinge: 'start', pane, size });
  assert.equal(leafKind(info([204, 83, 15]), 1), 'door');
  assert.equal(leafKind(info([75, 60, 4]), 1), 'furniture');
  assert.equal(leafKind(info([123, 64, 4], true), 1), 'window');
  assert.equal(leafKind(info([2.04, 0.83, 0.15]), 100), 'door', 'modèle en mètres');
});
