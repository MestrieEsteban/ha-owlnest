import test from 'node:test';
import assert from 'node:assert/strict';
import { itemElevation, supportOf } from './furniture.mjs';

// Tailles données explicitement : le test ne charge aucun modèle.
const it = (id, model, x, y, size, extra = {}) => ({ id, model, x, y, rotation: 0, size, ...extra });
const plan = (items) => ({ version: 2, wallHeight: 2.5, wallThickness: 0.15, nodes: [], walls: [], rooms: [], openings: [], items });

test('une plante lâchée sur le meuble télé se pose dessus', () => {
  const stand = it('s', 'cabinetTelevision', 1, 1, [1.6, 0.5, 0.62]);
  const plant = it('p', 'pottedPlant', 1.3, 1.05, [0.42, 0.48, 1.31]);
  const p = plan([stand, plant]);
  assert.equal(supportOf(p, plant)?.id, 's');
  assert.equal(itemElevation(p, plant), 0.62);
  assert.equal(itemElevation(p, stand), 0, 'le meuble reste au sol');
});

test('une chaise contre une table, centre à côté, reste au sol', () => {
  const table = it('t', 'table', 2, 2, [1.68, 0.89, 0.65]);
  const chair = it('c', 'chair', 2, 2.7, [0.4, 0.4, 0.94]);
  assert.equal(itemElevation(plan([table, chair]), chair), 0);
});

test('un canapé sur un tapis : le tapis reste dessous', () => {
  const rug = it('r', 'rugRectangle', 3, 3, [3.14, 1.84, 0.02]);
  const sofa = it('s', 'loungeSofa', 3, 3.2, [1.96, 0.82, 0.92]);
  const p = plan([rug, sofa]);
  assert.equal(itemElevation(p, rug), 0);
  assert.equal(itemElevation(p, sofa), 0.02);
});

test('empilés : une lampe sur une console posée sur un tapis', () => {
  const rug = it('r', 'rugRectangle', 0, 0, [3.14, 1.84, 0.02]);
  const desk = it('d', 'sideTable', 0.2, 0, [1.07, 0.44, 0.77]);
  const lamp = it('l', 'lampRoundTable', 0.3, 0, [0.3, 0.35, 0.63]);
  assert.equal(itemElevation(plan([rug, desk, lamp]), lamp).toFixed(2), '0.79');
});

test('une plante devant la télé va sur le meuble, pas sur l’écran', () => {
  const stand = it('s', 'cabinetTelevision', 1, 1, [1.6, 0.5, 0.62]);
  const tv = it('t', 'televisionModern', 1, 1, [1.37, 0.26, 0.91]);
  const plant = it('p', 'pottedPlant', 1.4, 1, [0.42, 0.48, 1.31]);
  const p = plan([stand, tv, plant]);
  assert.equal(itemElevation(p, tv), 0.62);
  assert.equal(itemElevation(p, plant), 0.62);
});

test('une hauteur choisie à la main prime', () => {
  const stand = it('s', 'cabinetTelevision', 1, 1, [1.6, 0.5, 0.62]);
  const plant = it('p', 'pottedPlant', 1, 1, [0.42, 0.48, 1.31], { elevation: 0 });
  assert.equal(itemElevation(plan([stand, plant]), plant), 0);
});
