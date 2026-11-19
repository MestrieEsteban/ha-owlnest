import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PIN_DISC, cardPinLook, clampPinOpacity, hostMargin, pinDiscStep, resolvePinLook,
} from './pin-look.mjs';

test('sans réglage, les pastilles traversent les murs et le disque est opaque', () => {
  assert.deepEqual(cardPinLook(null), { throughWalls: true, opacity: 1 });
  assert.deepEqual(cardPinLook({}), { throughWalls: true, opacity: 1 });
});

test('la carte peut cacher les pastilles derrière les murs et ouvrir le disque', () => {
  assert.deepEqual(cardPinLook({ throughWalls: false, opacity: 0.2 }), { throughWalls: false, opacity: 0.45 });
});

test('l’ancre sans avis suit la carte, un avis explicite gagne', () => {
  const card = cardPinLook({ throughWalls: false, opacity: PIN_DISC.soft });
  assert.deepEqual(resolvePinLook(card, {}), card);
  assert.deepEqual(resolvePinLook(card, { throughWalls: true }), { throughWalls: true, opacity: PIN_DISC.soft });
  assert.deepEqual(resolvePinLook(card, { opacity: 1 }), { throughWalls: false, opacity: 1 });
});

test('l’opacité reste entre le verre et le plein', () => {
  assert.equal(clampPinOpacity(0), 0.45);
  assert.equal(clampPinOpacity(2), 1);
  assert.equal(clampPinOpacity(Number.NaN), 1);
  assert.equal(pinDiscStep(0.5), 'glass');
  assert.equal(pinDiscStep(0.9), 'solid');
  assert.equal(pinDiscStep(PIN_DISC.soft), 'soft');
});

test('la marge d’hôte grandit avec la maison, sans passer sous 8 cm', () => {
  assert.equal(hostMargin(1), 0.08);
  assert.equal(hostMargin(20), 0.3);
});
