import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  emissiveIntensity,
  resolveLightHost,
  resolveLightHosts,
  lightHostsCenter,
  hostIsOpeningPiece,
  LightEmissiveController,
} from './light-emissive.mjs';
import { DEFAULT_EMISSIVE_LEVEL } from './light-fields.mjs';
import { stampOrder } from './model-outline.mjs';

test('emissiveIntensity : niveau × brillance si lié', () => {
  assert.equal(emissiveIntensity(0.8, 0.5, true), 0.4);
  assert.equal(emissiveIntensity(0.8, 0.5, false), 0.8);
  assert.equal(emissiveIntensity(0.8, 0, true), 0);
  assert.equal(emissiveIntensity(DEFAULT_EMISSIVE_LEVEL, 1, true), DEFAULT_EMISSIVE_LEVEL);
});

test('emissiveIntensity : bornes 0–1', () => {
  assert.equal(emissiveIntensity(2, 1, false), 1);
  assert.equal(emissiveIntensity(-1, 1, false), 0);
  assert.equal(emissiveIntensity(1, 2, true), 1);
});

function lampModel() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x444444, emissive: 0x000000, emissiveIntensity: 0 });
  const shade = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  shade.name = 'abatjour';
  const other = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat.clone());
  other.name = 'mur';
  const root = new THREE.Group();
  root.add(shade, other);
  stampOrder(root);
  return { root, shade, mat };
}

test('resolveLightHost : par index puis par nom', () => {
  const { root, shade } = lampModel();
  assert.equal(resolveLightHost(root, { lightMeshIndex: 0, lightMesh: 'abatjour' }), shade);
  assert.equal(resolveLightHost(root, { lightMesh: 'abatjour' }), shade);
  assert.equal(resolveLightHost(root, {}), null);
});

test('resolveLightHosts + lightHostsCenter : AABB combinée', () => {
  const { root, shade } = lampModel();
  const other = root.children[1];
  shade.position.set(-2, 0, 0);
  other.position.set(2, 0, 0);
  shade.updateMatrixWorld(true);
  other.updateMatrixWorld(true);
  const hosts = resolveLightHosts(root, {
    lightMeshes: [
      { mesh: 'abatjour', meshIndex: 0 },
      { mesh: 'mur', meshIndex: 1 },
    ],
  });
  assert.equal(hosts.length, 2);
  const c = lightHostsCenter(hosts);
  assert.ok(Math.abs(c.x) < 0.01);
});

test('LightEmissiveController : multi-hôtes', () => {
  const { root, shade, mat } = lampModel();
  const other = root.children[1];
  const ctrl = new LightEmissiveController();
  const anchors = new Map([
    ['a1', {
      domain: 'light',
      entityId: 'light.lampe',
      lightMeshes: [
        { mesh: 'abatjour', meshIndex: 0 },
        { mesh: 'mur', meshIndex: 1 },
      ],
      emissiveLevel: 0.8,
      linkEmissiveBrightness: false,
      hidden: false,
      light: null,
      worldPos: new THREE.Vector3(),
      targetIntensity: 0,
      targetColor: new THREE.Color(1, 1, 1),
      label: 'lampe',
    }],
  ]);
  const hass = { states: { 'light.lampe': { state: 'on', attributes: { brightness: 255 } } } };
  assert.equal(ctrl.sync(root, anchors, hass), true);
  assert.notEqual(shade.material, mat);
  assert.notEqual(other.material, mat);
  assert.ok((shade.material.emissiveIntensity ?? 0) > 0.7);
  assert.ok((other.material.emissiveIntensity ?? 0) > 0.7);
  ctrl.dispose();
});

test('hostIsOpeningPiece : true si owlnestPartId dans la chaîne', () => {
  const { shade } = lampModel();
  assert.equal(hostIsOpeningPiece(shade), false);
  shade.userData.owlnestPartId = 'p1';
  assert.equal(hostIsOpeningPiece(shade), true);
});

test('LightEmissiveController : clone, n’altère pas le matériau partagé, skip ouvrant', () => {
  const { root, shade, mat } = lampModel();
  const ctrl = new LightEmissiveController();
  const anchors = new Map([
    ['a1', {
      domain: 'light',
      entityId: 'light.lampe',
      lightMesh: 'abatjour',
      lightMeshIndex: 0,
      emissiveLevel: 0.8,
      linkEmissiveBrightness: true,
      hidden: false,
      light: null,
      worldPos: new THREE.Vector3(),
      targetIntensity: 0,
      targetColor: new THREE.Color(),
      label: 'lampe',
    }],
  ]);
  anchors.get('a1').targetColor.setRGB(1, 0.25, 0);
  const hass = {
    states: {
      'light.lampe': { state: 'on', attributes: { brightness: 128 } },
    },
  };
  assert.equal(ctrl.sync(root, anchors, hass), true);
  assert.notEqual(shade.material, mat);
  assert.equal(mat.emissiveIntensity, 0);
  assert.ok((shade.material.emissiveIntensity ?? 0) > 0.3);
  // Même couleur que targetColor (Point/Spot), pas un blanc fixe.
  assert.ok(shade.material.emissive.r > 0.9);
  assert.ok(shade.material.emissive.g < 0.4);
  assert.ok(shade.material.emissive.b < 0.1);

  shade.userData.owlnestPartId = 'part_x';
  ctrl.dispose();
  // Remonter après marquage ouvrant : sync ne doit plus peindre.
  const ctrl2 = new LightEmissiveController();
  assert.equal(ctrl2.sync(root, anchors, hass), false);
  ctrl2.dispose();
});
