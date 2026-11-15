import test from 'node:test';
import assert from 'node:assert/strict';
import { rankLightBudgetEntries } from './light-budget.mjs';

test('rankLightBudgetEntries : étage actif puis allumées puis ordre', () => {
  const lamps = [
    { id: 'off-floor0', floor: 0, on: false },
    { id: 'on-floor1', floor: 1, on: true },
    { id: 'on-floor0-b', floor: 0, on: true },
    { id: 'on-floor0-a', floor: 0, on: true },
    { id: 'off-floor1', floor: 1, on: false },
  ];
  const ranked = rankLightBudgetEntries(lamps, {
    floorOf: (l) => l.floor,
    activeFloor: 0,
    isOn: (l) => l.on,
  });
  assert.deepEqual(
    ranked.map((l) => l.id),
    ['on-floor0-b', 'on-floor0-a', 'off-floor0', 'on-floor1', 'off-floor1'],
  );
});

test('rankLightBudgetEntries : budget 2 garde les allumées de l’étage', () => {
  const lamps = [
    { id: 'old-off', floor: 0, on: false },
    { id: 'old-on', floor: 0, on: true },
    { id: 'new-on', floor: 0, on: true },
  ];
  const ranked = rankLightBudgetEntries(lamps, {
    floorOf: (l) => l.floor,
    activeFloor: 0,
    isOn: (l) => l.on,
  });
  assert.deepEqual(ranked.slice(0, 2).map((l) => l.id), ['old-on', 'new-on']);
});

// Régression : si on classe avant syncLights, tout est « off » et les anciennes
// (en tête) gardent le budget — une neuve allumée ne projette jamais.
test('rankLightBudgetEntries : sans isOn exact, les neuves perdent le budget', () => {
  const lamps = [
    { id: 'old-1', floor: 0 },
    { id: 'old-2', floor: 0 },
    { id: 'new-on', floor: 0 },
  ];
  const beforeSync = rankLightBudgetEntries(lamps, {
    floorOf: (l) => l.floor,
    activeFloor: 0,
    isOn: () => false,
  });
  assert.deepEqual(beforeSync.slice(0, 2).map((l) => l.id), ['old-1', 'old-2']);

  const afterSync = rankLightBudgetEntries(lamps, {
    floorOf: (l) => l.floor,
    activeFloor: 0,
    isOn: (l) => l.id === 'new-on' || l.id === 'old-1',
  });
  assert.deepEqual(afterSync.slice(0, 2).map((l) => l.id), ['old-1', 'new-on']);
});
