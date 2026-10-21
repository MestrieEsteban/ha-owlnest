import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  effectMatches, effectActive, EffectController, effectTargetKey, effectTargets,
  effectWithoutTarget, effectWithTarget,
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

test('material outline : arêtes sans teinter la surface', () => {
  const { root, rad, shared } = scene();
  const c = new EffectController();
  c.build(root, [{ ...MATERIAL, style: 'outline' }]);
  c.applyStates({
    'climate.salon': { state: 'heat', attributes: { hvac_action: 'heating' } },
  });
  assert.equal(rad.material, shared, 'surface inchangée');
  const lines = rad.children.filter((o) => o.name === '__owlnest_effect_outline');
  assert.equal(lines.length, 1);
  assert.ok(lines[0].isLineSegments);
  c.applyStates({
    'climate.salon': { state: 'off', attributes: { hvac_action: 'idle' } },
  });
  assert.equal(rad.children.filter((o) => o.name === '__owlnest_effect_outline').length, 0);
  c.dispose();
});

test('material outline → fill : retire les arêtes et teinte', () => {
  const { root, rad, shared } = scene();
  const c = new EffectController();
  c.build(root, [{ ...MATERIAL, style: 'outline' }]);
  c.applyStates({ 'climate.salon': { state: 'heat', attributes: {} } });
  assert.equal(c.configure({ ...MATERIAL, style: undefined }), true);
  assert.equal(rad.children.filter((o) => o.name === '__owlnest_effect_outline').length, 0);
  assert.notEqual(rad.material, shared);
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

test('effectWithoutTarget : retire un extra ; promotion si principale', () => {
  const cfg = {
    ...MATERIAL,
    targets: [
      { mesh: 'mur', meshIndex: 2, triangle: 0, node: 'mur', nodeIndex: 2, label: 'mur' },
      { mesh: 'personne', meshIndex: 1, triangle: 0, node: 'personne', nodeIndex: 1 },
    ],
  };
  const dropExtra = effectWithoutTarget(cfg, 1);
  assert.equal(dropExtra.mesh, 'radiateur');
  assert.equal(dropExtra.targets?.length, 1);
  assert.equal(dropExtra.targets?.[0].node, 'personne');

  const promote = effectWithoutTarget(cfg, 0);
  assert.equal(promote.mesh, 'mur');
  assert.equal(promote.node, 'mur');
  assert.equal(promote.nodeIndex, 2);
  assert.equal(promote.targets?.length, 1);
  assert.equal(promote.targets?.[0].node, 'personne');

  assert.equal(effectWithoutTarget(MATERIAL, 0), MATERIAL, 'seule cible : inchangé');
});

test('effectWithTarget : ignore les doublons', () => {
  const once = effectWithTarget(MATERIAL, {
    mesh: 'mur', meshIndex: 2, triangle: 0, node: 'mur', nodeIndex: 2,
  });
  assert.equal(once.targets?.length, 1);
  const twice = effectWithTarget(once, {
    mesh: 'mur', meshIndex: 2, triangle: 0, node: 'mur', nodeIndex: 2,
  });
  assert.equal(twice.targets?.length, 1);
  const self = effectWithTarget(MATERIAL, {
    mesh: 'radiateur', meshIndex: 0, triangle: 0, node: 'radiateur', nodeIndex: 0,
  });
  assert.equal(self.targets, undefined);
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

test('seeThrough : overlays depthTest false quand actif, retirés sinon', () => {
  const { root, rad } = scene();
  const c = new EffectController();
  c.build(root, [{ ...MATERIAL, seeThrough: true }]);
  c.applyStates({
    'climate.salon': { state: 'off', attributes: { hvac_action: 'idle' } },
  });
  assert.equal(rad.children.filter((o) => o.userData.owlnestHelper).length, 0);

  c.applyStates({
    'climate.salon': { state: 'heat', attributes: { hvac_action: 'heating' } },
  });
  const overlays = rad.children.filter((o) => o.userData.owlnestHelper);
  assert.ok(overlays.length >= 1);
  const mat = overlays[0].material;
  assert.equal(mat.depthTest, false);
  assert.equal(mat.depthWrite, false);

  c.applyStates({
    'climate.salon': { state: 'off', attributes: { hvac_action: 'idle' } },
  });
  assert.equal(rad.children.filter((o) => o.userData.owlnestHelper).length, 0);

  c.configure({ ...MATERIAL, seeThrough: true });
  c.setPreview('e1', true);
  assert.ok(rad.children.some((o) => o.userData.owlnestHelper));
  c.setPreview('e1', null);
  c.dispose();
  assert.equal(rad.children.filter((o) => o.userData.owlnestHelper).length, 0);
});

test('seeThrough : visibility pose aussi des overlays quand montré', () => {
  const { root, person } = scene();
  const c = new EffectController();
  c.build(root, [{ ...VISIBILITY, seeThrough: true }]);
  c.applyStates({ 'binary_sensor.presence': { state: 'on', attributes: {} } });
  assert.equal(person.visible, true);
  assert.ok(person.children.some((o) => o.userData.owlnestHelper));
  c.applyStates({ 'binary_sensor.presence': { state: 'off', attributes: {} } });
  assert.equal(person.visible, false);
  assert.equal(person.children.filter((o) => o.userData.owlnestHelper).length, 0);
});

test('cibles absentes : build signale missing et ne lève pas', () => {
  const { root } = scene();
  const c = new EffectController();
  const ghost = {
    ...MATERIAL,
    id: 'gone',
    mesh: 'objet_inexistant',
    meshIndex: 99,
    node: 'objet_inexistant',
    nodeIndex: 99,
  };
  const { ok, missing } = c.build(root, [ghost, MATERIAL]);
  assert.equal(ok, 1);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].id, 'gone');
  assert.equal(c.count, 1);
  // L'effet valide reste applicable.
  assert.equal(c.applyStates({
    'climate.salon': { state: 'heat', attributes: {} },
  }), true);
});

test('liste effects corrompue : build ignore sans lever', () => {
  const { root } = scene();
  const c = new EffectController();
  const { ok, missing } = c.build(root, /** @type {any} */ ('not-an-array'));
  assert.equal(ok, 0);
  assert.equal(missing.length, 0);
  assert.equal(c.built, true);
});

test('maille sans position : resolveMesh ne lève pas (via build)', () => {
  const { root, shared } = scene();
  const empty = new THREE.Mesh(new THREE.BufferGeometry(), shared);
  empty.name = 'radiateur_vide';
  root.add(empty);
  root.updateMatrixWorld(true);
  const c = new EffectController();
  // Sans `node` : on passe par resolveMesh (le nœud accepterait une maille vide).
  const { ok, missing } = c.build(root, [{
    ...MATERIAL,
    id: 'empty',
    mesh: 'radiateur_vide',
    meshIndex: 3,
    node: undefined,
    nodeIndex: undefined,
  }]);
  assert.equal(ok, 0);
  assert.equal(missing.length, 1);
  assert.equal(c.built, true);
});

test('duration absente : bascule instantanée (compat)', () => {
  const { root, rad, shared } = scene();
  const c = new EffectController();
  c.build(root, [MATERIAL]);
  c.applyStates({ 'climate.salon': { state: 'heat', attributes: {} } });
  assert.notEqual(rad.material, shared);
  c.applyStates({ 'climate.salon': { state: 'off', attributes: {} } });
  assert.equal(rad.material, shared);
  assert.equal(c.update(0.1), false);
});

test('duration : teinte interpolée via update(dt)', () => {
  const { root, rad, shared } = scene();
  const c = new EffectController();
  c.build(root, [{ ...MATERIAL, duration: 1 }]);
  c.applyStates({ 'climate.salon': { state: 'heat', attributes: {} } });
  // À t=0 juste après activation : encore sans teinte (current ≈ 0).
  assert.equal(rad.material, shared);
  assert.equal(c.update(0.5), true);
  assert.notEqual(rad.material, shared);
  const mid = rad.material.color.r;
  // La frame qui atteint le but renvoie encore true (comme PartController).
  assert.equal(c.update(0.5), true);
  assert.ok(rad.material.color.r >= mid - 1e-6);
  assert.ok(rad.material.color.r > 0.5);
  assert.equal(c.update(0.1), false, 'au repos : plus de mouvement');

  c.applyStates({ 'climate.salon': { state: 'off', attributes: {} } });
  assert.equal(c.update(0.5), true);
  assert.notEqual(rad.material, shared, 'mi-parcours extinction : encore teinté');
  assert.equal(c.update(0.6), true, 'frame d’arrivée');
  assert.equal(rad.material, shared);
  assert.equal(c.update(0.1), false);
});

test('duration : visibility fond via opacité des copies', () => {
  const { root, person } = scene();
  const original = person.material;
  const c = new EffectController();
  c.build(root, [{ ...VISIBILITY, duration: 1 }]);
  c.applyStates({ 'binary_sensor.presence': { state: 'on', attributes: {} } });
  assert.equal(person.visible, false, 'fraction 0 : encore caché');
  assert.equal(c.update(0.5), true);
  assert.equal(person.visible, true);
  assert.notEqual(person.material, original);
  assert.ok(person.material.opacity > 0 && person.material.opacity < 1);
  assert.equal(c.update(0.6), true, 'frame d’arrivée');
  assert.equal(person.visible, true);
  assert.ok(Math.abs(person.material.opacity - 1) < 1e-3);
  assert.equal(c.update(0.1), false);

  c.applyStates({ 'binary_sensor.presence': { state: 'off', attributes: {} } });
  assert.equal(c.update(0.5), true);
  assert.equal(person.visible, true);
  assert.ok(person.material.opacity < 1);
  assert.equal(c.update(0.6), true);
  assert.equal(person.visible, false);
  assert.equal(person.material, original, 'au repos : matériaux d’origine');
  assert.equal(c.update(0.1), false);
});

test('duration : outline et seeThrough suivent la fraction', () => {
  const { root, rad } = scene();
  const c = new EffectController();
  c.build(root, [{ ...MATERIAL, style: 'outline', seeThrough: true, duration: 1, glow: 1 }]);
  c.applyStates({ 'climate.salon': { state: 'heat', attributes: {} } });
  assert.equal(rad.children.filter((o) => o.name === '__owlnest_effect_outline').length, 0);
  c.update(0.5);
  const lines = rad.children.filter((o) => o.name === '__owlnest_effect_outline');
  assert.equal(lines.length, 1);
  assert.ok(lines[0].material.opacity > 0 && lines[0].material.opacity < 1);
  // seeThrough est désactivé en outline (depthTest sur les arêtes) — pas d’overlay fill.
  c.update(0.6);
  assert.equal(c.update(0.1), false);
  assert.ok(Math.abs(lines[0].material.opacity - 1) < 1e-3 || lines[0].material.opacity >= 0.99);
});

test('setPreview : bascule instantanée malgré duration', () => {
  const { root, rad, shared } = scene();
  const c = new EffectController();
  c.build(root, [{ ...MATERIAL, duration: 2 }]);
  assert.equal(c.setPreview('e1', true), true);
  assert.notEqual(rad.material, shared);
  assert.equal(c.update(0.1), false, 'aperçu forcé : pas d’animation en cours');
  c.setPreview('e1', false);
  assert.equal(rad.material, shared);
});
