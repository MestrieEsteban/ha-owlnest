import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listLightHosts, setLightHosts, sameLightHost, persistLightFields, hasLightHost,
  listLightStyles, setLightStyles, persistLightStyles, hasDirectionalStyle,
  DEFAULT_EMISSIVE_LEVEL,
} from './light-fields.mjs';

test('listLightHosts : legacy mono → un élément', () => {
  assert.deepEqual(
    listLightHosts({ lightMesh: 'abatjour', lightMeshIndex: 2, lightTriangle: 1 }),
    [{ mesh: 'abatjour', meshIndex: 2, triangle: 1 }],
  );
  assert.deepEqual(listLightHosts({}), []);
});

test('listLightHosts : lightMeshes prime sur legacy', () => {
  const hosts = listLightHosts({
    lightMesh: 'old',
    lightMeshes: [
      { mesh: 'a', meshIndex: 0 },
      { mesh: 'b', meshIndex: 1 },
      { mesh: 'a', meshIndex: 0 },
    ],
  });
  assert.equal(hosts.length, 2);
  assert.equal(hosts[0].mesh, 'a');
  assert.equal(hosts[1].mesh, 'b');
});

test('setLightHosts : mono → champs legacy, multi → lightMeshes', () => {
  const a = {};
  setLightHosts(a, [{ mesh: 'seul', meshIndex: 3 }]);
  assert.equal(a.lightMesh, 'seul');
  assert.equal(a.lightMeshIndex, 3);
  assert.equal(a.lightMeshes, undefined);

  setLightHosts(a, [
    { mesh: 'x', meshIndex: 0 },
    { mesh: 'y', meshIndex: 1 },
  ]);
  assert.equal(a.lightMesh, undefined);
  assert.equal(a.lightMeshes?.length, 2);

  setLightHosts(a, []);
  assert.equal(hasLightHost(a), false);
});

test('sameLightHost : index ou nom', () => {
  assert.equal(sameLightHost({ mesh: 'a', meshIndex: 1 }, { mesh: 'b', meshIndex: 1 }), true);
  assert.equal(sameLightHost({ mesh: 'a' }, { mesh: 'a' }), true);
  assert.equal(sameLightHost({ mesh: 'a' }, { mesh: 'b' }), false);
});

test('persistLightFields : hors défauts ; multi → lightMeshes', () => {
  const one = persistLightFields({
    lightMesh: 'abatjour',
    lightMeshIndex: 0,
    castLight: false,
    emissiveLevel: DEFAULT_EMISSIVE_LEVEL,
    attachLightToObject: true,
  });
  assert.equal(one.lightMesh, 'abatjour');
  assert.equal(one.lightMeshes, undefined);
  assert.equal(one.castLight, false);
  assert.equal(one.emissiveLevel, undefined);
  assert.equal(one.attachLightToObject, true);

  const many = persistLightFields({
    lightMeshes: [
      { mesh: 'a', meshIndex: 0 },
      { mesh: 'b', meshIndex: 1 },
    ],
  });
  assert.equal(many.lightMesh, undefined);
  assert.equal(many.lightMeshes?.length, 2);
});

test('listLightStyles / setLightStyles : legacy + multi', () => {
  assert.deepEqual(listLightStyles({}), ['point']);
  assert.deepEqual(listLightStyles({ lightStyle: 'spot' }), ['spot']);
  assert.deepEqual(listLightStyles({ lightStyles: ['mesh', 'point', 'mesh'] }), ['point', 'mesh']);
  const a = {};
  setLightStyles(a, ['spot']);
  assert.equal(a.lightStyle, 'spot');
  assert.equal(a.lightStyles, undefined);
  setLightStyles(a, ['point', 'mesh']);
  assert.equal(a.lightStyle, undefined);
  assert.deepEqual(a.lightStyles, ['point', 'mesh']);
  assert.equal(hasDirectionalStyle({ lightStyles: ['point', 'beam'] }), true);
  assert.deepEqual(persistLightStyles({ lightStyles: ['point', 'spot'] }), {
    lightStyles: ['point', 'spot'],
  });
  assert.deepEqual(persistLightStyles({ lightStyle: 'point' }), {});
});
