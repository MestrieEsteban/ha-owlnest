import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sceneFileName, serializeScene, parseSceneFile, suggestSceneId, uniqueSceneId,
  SceneFileParseError,
} from './scene-file.mjs';

const EFFECT = {
  id: 'fx1',
  kind: 'visibility',
  entity: 'binary_sensor.presence',
  mesh: 'personne',
  triangle: 0,
  node: 'personne',
};

const scene = {
  version: 1,
  scene_id: 'salon',
  model_url: '/owlnest_models/salon.glb',
  anchors: [{ id: 'anchor_000', entity: 'light.salon', position: [1, 2, 3] }],
  camera_views: [],
  cards: [],
  rules: [],
  parts: [{ id: 'p1', mesh: 'door', motion: 'swing' }],
  effects: [EFFECT],
  settings: { language: 'fr' },
};

const errorCode = (fn) => {
  try { fn(); } catch (err) { return err instanceof SceneFileParseError ? err.code : String(err); }
  return null;
};

test('le nom du fichier : la scène, puis la date et l’heure locales', () => {
  assert.equal(sceneFileName('salon', new Date(2026, 9, 5, 9, 7, 3)), 'salon_2026-10-05_09-07-03.json');
});

test('le nom du fichier ne garde aucun caractère refusé par Windows', () => {
  const now = new Date(2026, 0, 1, 0, 0, 0);
  assert.equal(sceneFileName('rez/de:chaussée?', now), 'rez_de_chaussée__2026-01-01_00-00-00.json');
  assert.equal(sceneFileName('maison. ', now), 'maison_2026-01-01_00-00-00.json');
  assert.equal(sceneFileName('   ', now), 'scene_2026-01-01_00-00-00.json');
});

test('une scène exportée se relit à l’identique', () => {
  assert.deepEqual(parseSceneFile(serializeScene(scene)), scene);
});

test('une scène nue, copiée du stockage, est acceptée', () => {
  const back = parseSceneFile(JSON.stringify({ scene_id: 'x', anchors: [] }));
  assert.equal(back.scene_id, 'x');
  assert.deepEqual(back.rules, []);
  assert.deepEqual(back.parts, []);
  assert.deepEqual(back.effects, []);
  assert.equal(back.model_url, '');
});

test('export / import conserve model_url et effects (copie de scène)', () => {
  const back = parseSceneFile(serializeScene(scene));
  assert.equal(back.model_url, '/owlnest_models/salon.glb');
  assert.deepEqual(back.effects, [EFFECT]);
  assert.deepEqual(back.parts, scene.parts);
});

test('effects non-tableau est refusé comme les autres listes', () => {
  assert.equal(
    errorCode(() => parseSceneFile(JSON.stringify({ anchors: [], effects: 'x' }))),
    'not_a_scene',
  );
});

test('un fichier qui n’est pas une scène est refusé', () => {
  assert.equal(errorCode(() => parseSceneFile('{oops')), 'invalid_json');
  assert.equal(errorCode(() => parseSceneFile('[]')), 'not_a_scene');
  assert.equal(errorCode(() => parseSceneFile('{"name":"x"}')), 'not_a_scene');
  assert.equal(errorCode(() => parseSceneFile('{"anchors":[],"rules":"x"}')), 'not_a_scene');
  assert.equal(errorCode(() => parseSceneFile('{"format":"owlnest-scene","version":1,"scene":null}')), 'not_a_scene');
});

test('un fichier d’une version future est refusé plutôt que mal lu', () => {
  const file = JSON.stringify({ format: 'owlnest-scene', version: 2, scene });
  assert.equal(errorCode(() => parseSceneFile(file)), 'unsupported_version');
});

test('le nom proposé à l’import : celui de la scène, sinon celui du fichier sans la date', () => {
  assert.equal(suggestSceneId(scene, 'autre.json'), 'salon');
  const anon = { ...scene, scene_id: '' };
  assert.equal(suggestSceneId(anon, 'cuisine_2026-10-15_21-10-05.json'), 'cuisine');
  assert.equal(suggestSceneId(anon, 'cuisine.JSON'), 'cuisine');
  assert.equal(suggestSceneId(anon, '.json'), 'scene');
});

test('les champs inconnus d’une scène sont conservés, ceux de l’enveloppe ignorés', () => {
  const wrapped = JSON.parse(serializeScene({ ...scene, extra: 1, nested: { x: true } }));
  wrapped.note = 'enveloppe';
  const back = parseSceneFile(JSON.stringify(wrapped));
  assert.equal(back.extra, 1);
  assert.deepEqual(back.nested, { x: true });
  assert.equal(back.note, undefined);
});

test('une enveloppe sans numéro de version se lit comme la version courante', () => {
  const wrapped = JSON.parse(serializeScene(scene));
  delete wrapped.version;
  assert.equal(parseSceneFile(JSON.stringify(wrapped)).scene_id, 'salon');
});

test('un identifiant déjà pris reçoit un suffixe, sans écraser', () => {
  assert.equal(uniqueSceneId('salon', []), 'salon');
  assert.equal(uniqueSceneId('salon', ['salon']), 'salon_2');
  assert.equal(uniqueSceneId('salon', ['salon', 'salon_2']), 'salon_3');
  assert.equal(uniqueSceneId('  ', ['scene']), 'scene_2');
});

test('dupliquer reprend tout le contenu sous un identifiant libre', () => {
  const dest = uniqueSceneId(scene.scene_id, [scene.scene_id, 'cuisine']);
  const copy = { ...scene, scene_id: dest };
  assert.equal(copy.scene_id, 'salon_2');
  const { scene_id: _src, ...restSrc } = scene;
  const { scene_id: _copy, ...restCopy } = copy;
  assert.deepEqual(restCopy, restSrc);
});
