import test from 'node:test';
import assert from 'node:assert/strict';
import { demoModelUrl, usesDemo, seedDemoAnchors, isPlaceholder, DEMO_ANCHORS } from './demo.mjs';

test('sans modèle ni dans la carte ni dans la scène, la démo s’active', () => {
  assert.equal(usesDemo(undefined, undefined), true);
  assert.equal(usesDemo('', '   '), true);
});

test('un modèle configuré quelque part désactive la démo', () => {
  assert.equal(usesDemo('/local/maison.glb', undefined), false);
  assert.equal(usesDemo(undefined, '/local/maison.glb'), false);
});

test('le modèle est servi par l’intégration, sauf indication du mode dev', () => {
  assert.equal(demoModelUrl(), '/owlnest_frontend/demo.glb');
  globalThis.__OWLNEST_DEMO_URL = 'http://dev:5173/demo.glb';
  try {
    assert.equal(demoModelUrl(), 'http://dev:5173/demo.glb');
  } finally {
    delete globalThis.__OWLNEST_DEMO_URL;
  }
});

test('une scène vide reçoit les ancres à relier', () => {
  const seeded = seedDemoAnchors([], (id) => `«${id}»`);
  assert.equal(seeded.length, DEMO_ANCHORS.length);
  for (const a of seeded) {
    assert.equal(a.entity, '', 'aucune entité : c’est à l’utilisateur de choisir');
    assert.equal(a.kind, 'entity');
    assert.ok(a.label.startsWith('«'), 'le libellé passe par la traduction');
    assert.equal(a.position.length, 3);
  }
});

test('une scène déjà commencée ne reçoit rien', () => {
  // On ne repose pas les ancres de démo par-dessus le travail de l’utilisateur.
  assert.deepEqual(seedDemoAnchors([{ id: 'x' }], (id) => id), []);
});

test('les positions sont copiées, pas partagées', () => {
  const a = seedDemoAnchors([], (id) => id);
  a[0].position[0] = 999;
  assert.notEqual(DEMO_ANCHORS[0].position[0], 999);
});

test('seule une ancre d’entité sans entité est un emplacement à relier', () => {
  assert.equal(isPlaceholder({ entity: '', kind: 'entity' }), true);
  assert.equal(isPlaceholder({ entity: '' }), true, 'la nature par défaut est « entité »');
  assert.equal(isPlaceholder({ entity: 'light.salon', kind: 'entity' }), false);
  assert.equal(isPlaceholder({ entity: '', kind: 'label' }), false, 'une étiquette n’a pas d’entité, et c’est voulu');
});

test('les ancres de démo tombent dans la maison', () => {
  // Repère recentré : la maison fait 4 × 3 unités, donc ±2 et ±1,5 au plus.
  for (const a of DEMO_ANCHORS) {
    assert.ok(Math.abs(a.position[0]) <= 2.1 && Math.abs(a.position[2]) <= 1.6, `${a.id} hors de la maison`);
  }
});
