import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { hostMargin } from './pin-look.mjs';
import {
  PIN_ORDER_FRONT, htmlHoverNameShown, offsetTowardCamera, pinDepthFlags, pixelsForWorldSize, worldSizeForPixels,
} from './pin-sprite.mjs';

test('le nom HTML n’existe qu’au survol, jamais si le sprite le porte déjà', () => {
  assert.equal(htmlHoverNameShown(true, true), false);
  assert.equal(htmlHoverNameShown(true, false), false);
  assert.equal(htmlHoverNameShown(false, false), false);
  assert.equal(htmlHoverNameShown(false, true), true);
});

test('la profondeur suit « à travers les murs » et n’est jamais écrite', () => {
  assert.deepEqual(pinDepthFlags(false), { depthTest: true, depthWrite: false, renderOrder: 0 });
  const front = pinDepthFlags(true);
  assert.equal(front.depthTest, false);
  assert.equal(front.depthWrite, false);
  assert.equal(front.renderOrder, PIN_ORDER_FRONT);
  assert.ok(front.renderOrder > pinDepthFlags(false).renderOrder);
});

test('le décalage vers la caméra suit la marge de l’hôte', () => {
  const anchor = new THREE.Vector3(1, 2, 3);
  const camera = new THREE.Vector3(1, 2, 13);
  const margin = hostMargin(1);
  const out = offsetTowardCamera(anchor, camera, margin, new THREE.Vector3());
  assert.ok(Math.abs(out.z - (3 + margin)) < 1e-9);
  assert.equal(out.x, 1);
  assert.equal(out.y, 2);

  const diagonal = offsetTowardCamera(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(3, 0, 4),
    1,
    new THREE.Vector3(),
  );
  assert.ok(Math.abs(diagonal.x - 0.6) < 1e-9);
  assert.ok(Math.abs(diagonal.z - 0.8) < 1e-9);
  assert.equal(diagonal.y, 0);
});

test('le décalage ne dépasse pas la caméra', () => {
  const camera = new THREE.Vector3(0, 2, 0);
  const out = offsetTowardCamera(new THREE.Vector3(0, 0, 0), camera, 10, new THREE.Vector3());
  assert.ok(Math.abs(out.y - 1) < 1e-9);
  assert.ok(out.distanceTo(camera) > 0.5);
});

test('la pastille reste sur son ancre si la caméra est dessus', () => {
  const anchor = new THREE.Vector3(4, 5, 6);
  const out = offsetTowardCamera(anchor, anchor, hostMargin(4), new THREE.Vector3());
  assert.ok(out.distanceTo(anchor) < 1e-9);
});

test('une pastille de 50 px à 10 m sous 90° fait 10 unités de haut', () => {
  assert.ok(Math.abs(worldSizeForPixels(10, 90, 100, 50) - 10) < 1e-9);
  assert.ok(Math.abs(pixelsForWorldSize(10, 90, 100, 10) - 50) < 1e-9);
});
