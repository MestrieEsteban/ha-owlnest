import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSensor } from './format.mjs';

test('sans réglage : un arrondi qui se lit, à la française', () => {
  assert.equal(formatSensor('16.23', 'fr'), '16,2');
  assert.equal(formatSensor('64.69', 'en'), '64.7');
  assert.equal(formatSensor('17', 'fr'), '17');
  assert.equal(formatSensor('1013.25', 'fr'), '1013');
  assert.equal(formatSensor('0.045', 'fr'), '0,05');
  assert.equal(formatSensor('0', 'fr'), '0');
});

test('les décimales choisies sont respectées, zéros compris', () => {
  assert.equal(formatSensor('17', 'fr', 1), '17,0');
  assert.equal(formatSensor('2900', 'fr', 0), '2900');
  assert.equal(formatSensor('0.9', 'fr', 0), '1');
});

test('un texte qui n’est pas un nombre passe tel quel', () => {
  assert.equal(formatSensor('unavailable', 'fr'), 'unavailable');
  assert.equal(formatSensor('2026-10-10T12:00:00', 'fr'), '2026-10-10T12:00:00');
  assert.equal(formatSensor('—', 'fr'), '—');
});
