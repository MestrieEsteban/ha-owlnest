import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  effectMatches, effectActive, EffectController, effectTargetKey, effectTargets,
} from './effects-runtime.mjs';
import { DEFAULT_TINT_STRENGTH } from './part-tint.mjs';

const GREY = 0x808080;

function scene() {
  const shared = new THREE.MeshStandardMaterial({ color: GREY });
  const rad = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 0.2), shared);
  rad.name = 'radiateur';
  const person = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 0.3), shared.clone());
  person.name = 'personne';
  person.position.set(1, 0, 0);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 2.5, 0.2), shared);
  wall.name = 'mur';
  wall.position.set(3, 0, 0);
  const root = new THREE.Group();
  root.add(rad, person, wall);
  root.updateMatrixWorld(true);
  return { root, rad, person, wall, shared };
}

const MATERIAL = {
  id: 'e1',
  kind: 'material',
  entity: 'climate.salon',
  mesh: 'radiateur',
  meshIndex: 0,
  triangle: 0,
  node: 'radiateur',
  nodeIndex: 0,
  color: '#ff0000',
};

const VISIBILITY = {
  id: 'v1',
  kind: 'visibility',
  entity: 'binary_sensor.presence',
  mesh: 'personne',
  meshIndex: 1,
  triangle: 0,
  node: 'personne',
  nodeIndex: 1,
};

test('effectMatches : when sur l’état', () => {
  assert.equal(effectMatches('light.x', 'on', {}, undefined, ['on']), true);
  assert.equal(effectMatches('light.x', 'off', {}, undefined, ['on']), false);
});

test('effectMatches : when sur un attribut', () => {
  assert.equal(
    effectMatches('climate.salon', 'heat', { hvac_action: 'heating' }, 'hvac_action', ['heating']),
    true,
  );
  assert.equal(
    effectMatches('climate.salon', 'heat', { hvac_action: 'idle' }, 'hvac_action', ['heating']),
    false,
  );
});

test('effectMatches : sans when, attribut hors idle', () => {
  assert.equal(
    effectMatches('climate.salon', 'heat', { hvac_action: 'heating' }, 'hvac_action'),
    true,
  );
  assert.equal(
    effectMatches('climate.salon', 'heat', { hvac_action: 'idle' }, 'hvac_action'),
    false,
  );
});

test('effectMatches : sans when ni attribut, lit isOn', () => {
  assert.equal(effectMatches('light.x', 'on', {}), true);
  assert.equal(effectMatches('light.x', 'off', {}), false);
});

test('effectMatches : indisponible = faux', () => {
  assert.equal(effectMatches('light.x', 'unavailable', {}, undefined, ['on']), false);
  assert.equal(effectMatches('light.x', undefined, {}), false);
});

test('effectActive honore invert', () => {
  assert.equal(effectActive({ entity: 'light.x' }, 'on', {}), true);
  assert.equal(effectActive({ entity: 'light.x', invert: true }, 'on', {}), false);
  assert.equal(effectActive({ entity: 'light.x', invert: true }, 'off', {}), true);
});

test('material : teinte active quand la condition match, matériau partagé intact', () => {
  const { root, rad, wall, shared } = scene();
  const c = new EffectController();
  assert.equal(c.build(root, [MATERIAL]).ok, 1);
  assert.ok(rad.userData.owlnestLive);

  assert.equal(c.applyStates({
    'climate.salon': { state: 'heat', attributes: { hvac_action: 'heating' } },
  }), true);
  assert.notEqual(rad.material, shared);
  assert.ok(rad.material.color.r > rad.material.color.g);
  assert.ok(rad.material.emissive.r > 0);
  assert.equal(shared.color.getHex(), GREY);
  assert.equal(wall.material, shared);

  assert.equal(c.applyStates({
    'climate.salon': { state: 'off', attributes: { hvac_action: 'idle' } },
  }), true);
  assert.equal(rad.material, shared, 'éteint : matériau d’origine');
});

test('material : attribut hvac_action + when heating', () => {
  const { root, rad, shared } = scene();
  const c = new EffectController();
  c.build(root, [{ ...MATERIAL, attribute: 'hvac_action', when: ['heating'] }]);
  c.applyStates({
    'climate.salon': { state: 'heat', attributes: { hvac_action: 'idle' } },
  });
  assert.equal(rad.material, shared);
  c.applyStates({
    'climate.salon': { state: 'heat', attributes: { hvac_action: 'heating' } },
  });
  assert.notEqual(rad.material, shared);
  assert.ok(rad.material.emissive.r > 0);
});

test('material : configure change la couleur ; dispose restaure', () => {
  const { root, rad, shared } = scene();
  const c = new EffectController();
  c.build(root, [MATERIAL]);
  c.applyStates({ 'climate.salon': { state: 'heat', attributes: {} } });
  const m = rad.material;
  assert.notEqual(m, shared);
  assert.equal(c.configure({ ...MATERIAL, color: '#00ff00', strength: 1 }), true);
  assert.equal(rad.material, m, 'même copie');
  assert.equal(m.color.getHexString(), '00ff00');
  c.dispose();
  assert.equal(rad.material, shared);
  assert.equal(rad.userData.owlnestLive, undefined);
});

test('material : strength par défaut = dosage des ouvrants', () => {
  const a = (() => {
    const { root, rad } = scene();
    const c = new EffectController();
    c.build(root, [{ ...MATERIAL, strength: undefined }]);
    c.applyStates({ 'climate.salon': { state: 'heat', attributes: {} } });
    return rad.material.color.g;
  })();
  const b = (() => {
    const { root, rad } = scene();
    const c = new EffectController();
    c.build(root, [{ ...MATERIAL, id: 'e2', strength: DEFAULT_TINT_STRENGTH }]);
    c.applyStates({ 'climate.salon': { state: 'heat', attributes: {} } });
    return rad.material.color.g;
  })();
  assert.equal(a, b);
});

test('visibility : visible si condition, caché sinon', () => {
  const { root, person } = scene();
  assert.equal(person.visible, true);
  const c = new EffectController();
  c.build(root, [VISIBILITY]);
  assert.ok(person.userData.owlnestLive);

  c.applyStates({ 'binary_sensor.presence': { state: 'off', attributes: {} } });
  assert.equal(person.visible, false);

  c.applyStates({ 'binary_sensor.presence': { state: 'on', attributes: {} } });
  assert.equal(person.visible, true);
});

test('visibility : invert inverse le sens', () => {
  const { root, person } = scene();
  const c = new EffectController();
  c.build(root, [{ ...VISIBILITY, invert: true }]);
  c.applyStates({ 'binary_sensor.presence': { state: 'on', attributes: {} } });
  assert.equal(person.visible, false);
  c.applyStates({ 'binary_sensor.presence': { state: 'off', attributes: {} } });
  assert.equal(person.visible, true);
});

test('visibility : dispose restaure la visibilité d’origine', () => {
  const { root, person } = scene();
  person.visible = true;
  const c = new EffectController();
  c.build(root, [VISIBILITY]);
  c.applyStates({ 'binary_sensor.presence': { state: 'off', attributes: {} } });
  assert.equal(person.visible, false);
  c.dispose();
  assert.equal(person.visible, true);
  assert.equal(person.userData.owlnestLive, undefined);
});

test('visibility : remove restaure aussi', () => {
  const { root, person } = scene();
  const c = new EffectController();
  c.build(root, [VISIBILITY]);
  c.applyStates({ 'binary_sensor.presence': { state: 'off', attributes: {} } });
  assert.equal(c.remove('v1'), true);
  assert.equal(person.visible, true);
});

test('effectTargetKey distingue nœud et maille', () => {
  assert.equal(effectTargetKey(MATERIAL), 'node:radiateur#0');
  assert.equal(
    effectTargetKey({ ...MATERIAL, node: undefined, nodeIndex: undefined }),
    'mesh:radiateur#0:0',
  );
});

test('effectTargets : principale + liste', () => {
  const cfg = {
    ...MATERIAL,
    targets: [{ mesh: 'mur', meshIndex: 2, triangle: 0, node: 'mur', nodeIndex: 2 }],
  };
  assert.equal(effectTargets(cfg).length, 2);
  assert.equal(effectTargetKey(cfg), 'node:radiateur#0+node:mur#2');
});

test('material : plusieurs cibles teintées ensemble', () => {
  const { root, rad, wall, shared } = scene();
  const c = new EffectController();
  c.build(root, [{
    ...MATERIAL,
    targets: [{ mesh: 'mur', meshIndex: 2, triangle: 0, node: 'mur', nodeIndex: 2 }],
  }]);
  c.applyStates({ 'climate.salon': { state: 'heat', attributes: {} } });
  assert.notEqual(rad.material, shared);
  assert.notEqual(wall.material, shared);
  assert.ok(rad.material.emissive.r > 0);
  assert.ok(wall.material.emissive.r > 0);
  assert.equal(c.objectsOf('e1').length, 2);
});

test('material : setPreview force l’apparence hors état HA', () => {
  const { root, rad, shared } = scene();
  const c = new EffectController();
  c.build(root, [MATERIAL]);
  c.applyStates({ 'climate.salon': { state: 'off', attributes: { hvac_action: 'idle' } } });
  assert.equal(rad.material, shared);
  assert.equal(c.setPreview('e1', true), true);
  assert.notEqual(rad.material, shared);
  assert.ok(c.isPreviewing('e1'));
  // applyStates ne doit pas écraser l’aperçu forcé.
  c.applyStates({ 'climate.salon': { state: 'off', attributes: { hvac_action: 'idle' } } });
  assert.notEqual(rad.material, shared);
  c.setPreview('e1', null);
  c.applyStates({ 'climate.salon': { state: 'off', attributes: { hvac_action: 'idle' } } });
  assert.equal(rad.material, shared);
});

test('visibility : multi-cibles + configure change la liste', () => {
  const { root, person, wall } = scene();
  const c = new EffectController();
  c.build(root, [VISIBILITY]);
  c.applyStates({ 'binary_sensor.presence': { state: 'off', attributes: {} } });
  assert.equal(person.visible, false);
  assert.equal(wall.visible, true);
  assert.equal(c.configure({
    ...VISIBILITY,
    targets: [{ mesh: 'mur', meshIndex: 2, triangle: 0, node: 'mur', nodeIndex: 2 }],
  }), true);
  c.setPreview('v1', false);
  assert.equal(person.visible, false);
  assert.equal(wall.visible, false);
});
