import test from 'node:test';
import assert from 'node:assert/strict';
import { stateValueChipLabel } from './state-value-label.mjs';

test('discovered values use labelOf when provided', () => {
  const labelOf = (v) => (v === 'on' ? 'Allumé' : v);
  assert.equal(stateValueChipLabel('on', ['on', 'off'], labelOf), 'Allumé');
  assert.equal(stateValueChipLabel('off', ['on', 'off'], labelOf), 'off');
});

test('custom values stay raw even when labelOf would rewrite them', () => {
  const labelOf = (v) => (v === 'on' ? 'Allumé' : `«${v}»`);
  assert.equal(stateValueChipLabel('on', ['off'], labelOf), 'on');
  assert.equal(stateValueChipLabel('heating', ['on', 'off'], labelOf), 'heating');
  assert.equal(stateValueChipLabel('  weird ', ['on'], labelOf), '  weird ');
});

test('without labelOf everything is raw', () => {
  assert.equal(stateValueChipLabel('on', ['on', 'off']), 'on');
  assert.equal(stateValueChipLabel('custom', ['on']), 'custom');
});

test('typing a known state still gets the friendly label', () => {
  // Même chaîne que dans les options découvertes → même puce, libellé ami.
  const labelOf = (v) => (v === 'open' ? 'Ouverte' : v);
  assert.equal(stateValueChipLabel('open', ['open', 'closed'], labelOf), 'Ouverte');
});
