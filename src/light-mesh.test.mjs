import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { meshRectPose, castLightsOf, disposeEntryLights } from './light-mesh.mjs';

test('meshRectPose : largeur/hauteur = deux plus grands axes locaux', () => {
  const geo = new THREE.BoxGeometry(4, 0.1, 2);
  const mesh = new THREE.Mesh(geo);
  mesh.position.set(1, 2, 3);
  mesh.updateMatrixWorld(true);
  const pose = meshRectPose(mesh);
  assert.ok(Math.abs(pose.width - 4) < 1e-3, `width=${pose.width}`);
  assert.ok(Math.abs(pose.height - 2) < 1e-3, `height=${pose.height}`);
  assert.ok(pose.position.distanceTo(new THREE.Vector3(1, 2, 3)) < 1e-3);
});

test('meshRectPose : suit la rotation du mesh', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 0.05, 1));
  mesh.rotation.z = Math.PI / 2;
  mesh.updateMatrixWorld(true);
  const pose = meshRectPose(mesh);
  // Après 90° Z, l'axe mince (Y local) n'est plus vertical monde — le quaternion est non identité.
  assert.ok(pose.quaternion.angleTo(new THREE.Quaternion()) > 0.1);
  assert.ok(pose.width >= pose.height);
});

test('castLightsOf + disposeEntryLights', () => {
  const scene = new THREE.Scene();
  const a = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
  const b = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
  scene.add(a, b);
  const entry = { light: a, meshLights: [b], lightTarget: undefined };
  assert.equal(castLightsOf(entry).length, 2);
  disposeEntryLights(entry, scene);
  assert.equal(entry.light, null);
  assert.equal(entry.meshLights, undefined);
  assert.equal(scene.children.length, 0);
});
