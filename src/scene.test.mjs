/**
 * Régression : l'enregistrement des ancres (buildSceneFromEditor) ne doit
 * pas effacer effects / parts / rules / cards déjà présents sur la scène.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneFromEditor, emptyScene } from './scene.mjs';

const EFFECT = {
  id: 'fx1',
  kind: 'material',
  entity: 'climate.salon',
  mesh: 'radiateur',
  triangle: 0,
  color: '#ff0000',
};

const PART = {
  id: 'p1',
  mesh: 'porte',
  triangle: 0,
  motion: 'swing',
};

test('buildSceneFromEditor preserves effects and parts when updating anchors', () => {
  const current = {
    ...emptyScene('home'),
    model_url: '/owlnest_models/casa.glb',
    anchors: [{
      id: 'anchor_000',
      entity: 'light.salon',
      position: [1, 2, 3],
    }],
    parts: [PART],
    effects: [EFFECT],
    rules: [{ id: 'r1', when: [], then: [] }],
    cards: [{ id: 'c1', type: 'entity', entity: 'sensor.temp' }],
    camera_views: [{ id: 'view_1', label: 'Salon', position: [0, 1, 2], target: [0, 0, 0] }],
  };

  const editable = new Map([
    ['a0', {
      entity: 'light.salon',
      position: { x: 1.5, y: 2, z: 3 },
      label: '',
      hidden: false,
    }],
  ]);

  const next = buildSceneFromEditor('home', editable, current, {});

  assert.equal(next.anchors.length, 1);
  assert.deepEqual(next.anchors[0].position, [1.5, 2, 3]);
  assert.deepEqual(next.effects, [EFFECT]);
  assert.deepEqual(next.parts, [PART]);
  assert.deepEqual(next.rules, current.rules);
  assert.deepEqual(next.cards, current.cards);
  assert.deepEqual(next.camera_views, current.camera_views);
  assert.equal(next.model_url, '/owlnest_models/casa.glb');
});

test('buildSceneFromEditor yields empty effects when current has none', () => {
  const next = buildSceneFromEditor('home', new Map(), null, {});
  assert.deepEqual(next.effects, []);
  assert.deepEqual(next.parts, []);
});

test('duplicate scene data keeps model_url and effects under a new id', () => {
  const src = {
    ...emptyScene('salon'),
    model_url: '/owlnest_models/casa.glb',
    effects: [EFFECT],
    parts: [PART],
  };
  const copy = { ...src, scene_id: 'salon_2' };
  assert.equal(copy.scene_id, 'salon_2');
  assert.equal(copy.model_url, '/owlnest_models/casa.glb');
  assert.deepEqual(copy.effects, [EFFECT]);
  assert.deepEqual(copy.parts, [PART]);
});

test('emptyScene starts with empty effects and parts', () => {
  const s = emptyScene('x');
  assert.deepEqual(s.effects, []);
  assert.deepEqual(s.parts, []);
  assert.equal(s.model_url, '');
});
