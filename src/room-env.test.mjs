import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  REFLECTION_METALNESS, DEFAULT_REFLECTION_INTENSITY, materialReflects, assignReflectionMap,
  reflectionIntensity, reflectionMetalness, radiance,
  reflectionHdriUrl, reflectionMapSource, isReflectionHdr, reflectionUpdate,
} from './room-env.mjs';

test('un métal au seuil reflète, un mur non', () => {
  assert.equal(materialReflects(new THREE.MeshStandardMaterial({ metalness: REFLECTION_METALNESS })), true);
  assert.equal(materialReflects(new THREE.MeshStandardMaterial({ metalness: REFLECTION_METALNESS - 0.01 })), false);
  assert.equal(materialReflects(new THREE.MeshStandardMaterial()), false);
  assert.equal(materialReflects(new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0 })), true);
  assert.equal(materialReflects(new THREE.MeshBasicMaterial()), false);
});

test('seuls les métaux reçoivent l\'image, et l\'éteindre ne retire qu\'elle', () => {
  const map = new THREE.Texture();
  const foreign = new THREE.Texture();
  const steel = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.1 });
  const wall = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.8 });
  const kept = new THREE.MeshStandardMaterial({ metalness: 1 });
  kept.envMap = foreign;
  const basic = new THREE.MeshBasicMaterial();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), [steel, wall]));
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), kept));
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), basic));

  assignReflectionMap(root, map, null);
  assert.equal(steel.envMap, map);
  assert.ok(steel.version > 0);
  assert.equal(wall.envMap, null);
  assert.equal(kept.envMap, map);
  assert.equal(basic.envMap, null);

  const version = steel.version;
  assignReflectionMap(root, map, map);
  assert.equal(steel.version, version, 'déjà en place : pas de recompilation');

  assignReflectionMap(root, null, map);
  assert.equal(steel.envMap, null);
  assert.equal(kept.envMap, null);

  kept.envMap = foreign;
  assignReflectionMap(root, null, map);
  assert.equal(kept.envMap, foreign, 'une autre image n\'est pas la nôtre');
});

test('absent : intensité 1, seuil historique 0,5', () => {
  assert.equal(DEFAULT_REFLECTION_INTENSITY, 1);
  assert.equal(reflectionIntensity(undefined), 1);
  assert.equal(reflectionIntensity(0), 0);
  assert.equal(reflectionIntensity(1.25), 1.25);
  assert.equal(reflectionMetalness(undefined), REFLECTION_METALNESS);
  assert.equal(reflectionMetalness(0), 0);
  assert.equal(reflectionMetalness(0.8), 0.8);
});

test('une radiance fractionnaire reste grise', () => {
  const wall = radiance(0.45);
  assert.ok(Math.abs(wall.r - 0.45) < 1e-6);
  assert.ok(Math.abs(wall.g - 0.45) < 1e-6);
  assert.ok(Math.abs(wall.b - 0.45) < 1e-6);
  const opening = radiance(5);
  assert.equal(opening.r, 5);
});

test('le seuil inclut la borne et retire l\'image en dessous', () => {
  const at = new THREE.MeshStandardMaterial({ metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ metalness: 0.2 });
  const mirror = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.03 });
  const wall = new THREE.MeshStandardMaterial({ metalness: 0 });
  const foreign = new THREE.Texture();
  const painted = new THREE.MeshStandardMaterial({ metalness: 0.1 });
  painted.envMap = foreign;

  assert.equal(materialReflects(at, 0.5), true);
  assert.equal(materialReflects(new THREE.MeshStandardMaterial({ metalness: 0.5 - 1e-6 }), 0.5), false);
  assert.equal(materialReflects(glass, 0.2), true);
  assert.equal(materialReflects(glass, 0.25), false);
  assert.equal(materialReflects(mirror, 0.95), true);
  assert.equal(materialReflects(wall, 0), true);

  const map = new THREE.Texture();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), [at, glass, mirror, wall, painted]));

  assignReflectionMap(root, map, null, 1, 0.5);
  assert.equal(at.envMap, map);
  assert.equal(glass.envMap, null);
  assert.equal(mirror.envMap, map);
  assert.equal(wall.envMap, null);
  assert.equal(painted.envMap, foreign);

  assignReflectionMap(root, map, map, 1, 0.8);
  assert.equal(at.envMap, null, 'sous le nouveau seuil, notre image part');
  assert.equal(at.envMapIntensity, 1);
  assert.equal(mirror.envMap, map);
  assert.equal(painted.envMap, foreign);

  const mirrorVersion = mirror.version;
  assignReflectionMap(root, map, map, 1, 0.2);
  assert.equal(glass.envMap, map, 'abaisser le seuil pose l\'image');
  assert.equal(at.envMap, map);
  assert.equal(mirror.version, mirrorVersion, 'déjà qualifié : pas de recompilation');
  assert.equal(wall.envMap, null);
  assert.equal(painted.envMap, foreign, 'sous le seuil, une autre image reste');
});

test('l\'intensité se règle sans recompiler ni toucher les murs', () => {
  const map = new THREE.Texture();
  const metal = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.03 });
  const wall = new THREE.MeshStandardMaterial({ metalness: 0 });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), [metal, wall]));

  assignReflectionMap(root, map, null, 1, 0.5);
  assert.equal(metal.envMapIntensity, 1);
  const version = metal.version;

  assignReflectionMap(root, map, map, 0.4, 0.5);
  assert.equal(metal.envMap, map);
  assert.equal(metal.envMapIntensity, 0.4);
  assert.equal(metal.version, version);
  assert.equal(wall.envMap, null);
  assert.equal(wall.envMapIntensity, 1);

  assignReflectionMap(root, map, map, 0, 0.5);
  assert.equal(metal.envMap, map, '0 éteint le reflet sans retirer l\'image');
  assert.equal(metal.envMapIntensity, 0);
  assert.equal(wall.envMapIntensity, 1);
});

test('URL vide : pièce procédurale, sinon un fichier', () => {
  assert.equal(reflectionMapSource(undefined), 'procedural');
  assert.equal(reflectionMapSource(null), 'procedural');
  assert.equal(reflectionMapSource(''), 'procedural');
  assert.equal(reflectionMapSource('   '), 'procedural');
  assert.equal(reflectionHdriUrl(undefined), null);
  assert.equal(reflectionHdriUrl('  '), null);

  assert.equal(reflectionMapSource('/local/estudio.hdr'), 'file');
  assert.equal(reflectionHdriUrl('  /local/estudio.hdr '), '/local/estudio.hdr');
  assert.equal(reflectionMapSource('https://cdn.example/room.HDR'), 'file');
  // Une adresse non vide est un fichier, même si le chargeur RGBE la refusera.
  assert.equal(reflectionMapSource('/local/room.exr'), 'file');
});

test('seul un .hdr part au chargeur RGBE', () => {
  assert.equal(isReflectionHdr('/local/estudio.hdr'), true);
  assert.equal(isReflectionHdr('/local/estudio.HDR'), true);
  assert.equal(isReflectionHdr('/local/estudio.hdr?v=1'), true);
  assert.equal(isReflectionHdr('/local/estudio.hdr#a'), true);
  assert.equal(isReflectionHdr('/local/estudio.exr'), false);
  assert.equal(isReflectionHdr('/local/estudio.png'), false);
  assert.equal(isReflectionHdr('/local/estudio.hdr.bak'), false);
});

test('intensité et seuil ne reconstruisent pas le PMREM', () => {
  const url = '/local/estudio.hdr';
  // Déjà la pièce, ou déjà ce fichier, ou ce fichier en cours : on garde.
  assert.equal(reflectionUpdate('', null, null, undefined), 'keep');
  assert.equal(reflectionUpdate('', null, null, '  '), 'keep');
  assert.equal(reflectionUpdate(url, null, null, url), 'keep');
  assert.equal(reflectionUpdate('', url, null, `  ${url}  `), 'keep');
  assert.equal(reflectionUpdate('', null, url, url), 'keep');
  assert.equal(reflectionUpdate('', null, null, '/local/room.exr'), 'keep');

  assert.equal(reflectionUpdate(null, null, null, undefined), 'procedural');
  assert.equal(reflectionUpdate(url, null, null, ''), 'procedural');
  assert.equal(reflectionUpdate(url, null, null, '/local/room.exr'), 'procedural');
  assert.equal(reflectionUpdate('/local/other.hdr', null, '/local/room.exr', '/local/room.exr'), 'procedural');

  assert.equal(reflectionUpdate('', null, null, url), 'load');
  assert.equal(reflectionUpdate('/local/other.hdr', null, null, url), 'load');
  assert.equal(reflectionUpdate(null, null, null, url), 'load');
  assert.equal(reflectionUpdate('', '/local/old.hdr', null, url), 'load');
});
