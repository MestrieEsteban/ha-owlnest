import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildSceneFromEditor, sceneToEffectiveConfig } from './scene.mjs';

const plan = { version: 2, wallHeight: 2.5, wallThickness: 0.15, nodes: [], walls: [], rooms: [], openings: [], items: [{ id: 'i1', model: 'lampRoundFloor', x: 1, y: 1, rotation: 0, entity: 'light.salon' }] };
const current = { version: 1, scene_id: 's', anchors: [], camera_views: [], cards: [], rules: [], parts: [], plan };
const anchor = (extra) => ({ entity: 'light.salon', position: new THREE.Vector3(1, 1.4, 1), label: 'Lampe', ...extra });

test('enregistrer depuis l’éditeur d’ancres garde le logement dessiné', () => {
  const out = buildSceneFromEditor('s', new Map([['a', anchor()]]), current, {});
  assert.deepEqual(out.plan, plan);
});

test('l’ancre d’une lampe posée garde son identifiant, les autres sont renumérotées', () => {
  const out = buildSceneFromEditor('s', new Map([['a', anchor({ planId: 'plan_lamp_i1' })], ['b', anchor()]]), current, {});
  assert.deepEqual(out.anchors.map((a) => a.id), ['plan_lamp_i1', 'anchor_000']);
});

test('l’identifiant d’une ancre de lampe passe de la scène à la carte', () => {
  const scene = { ...current, anchors: [{ id: 'plan_lamp_i1', entity: 'light.salon', position: [1, 1.4, 1] }, { id: 'anchor_000', entity: 'light.x', position: [0, 0, 0] }] };
  const cfg = sceneToEffectiveConfig(scene, { type: 'custom:ha-3d-floorplan' });
  assert.deepEqual(cfg.anchors.map((a) => a.planId), ['plan_lamp_i1', undefined]);
});
