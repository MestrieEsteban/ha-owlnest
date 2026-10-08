import test from 'node:test';
import assert from 'node:assert/strict';
import { objToGlb, parseMtl, fileKey } from './obj-to-glb.mjs';

/** Relit un GLB : son JSON, et un accesseur sous forme de tableau. */
function read(glb) {
  const dv = new DataView(glb);
  assert.equal(dv.getUint32(0, true), 0x46546c67, 'magie glTF');
  assert.equal(dv.getUint32(8, true), glb.byteLength, 'longueur déclarée');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  const accessor = (i) => {
    const a = json.accessors[i];
    const v = json.bufferViews[a.bufferView];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
    const Ctor = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
    return Array.from(new Ctor(glb.slice(binStart + v.byteOffset, binStart + v.byteOffset + a.count * size * Ctor.BYTES_PER_ELEMENT)));
  };
  return { json, accessor };
}

// Un sol carré texturé et une porte rectangulaire, comme un export Sweet Home 3D.
const OBJ = `# test
mtllib maison.mtl
v 0 0 0
v 100 0 0
v 100 0 100
v 0 0 100
v 0 0 0
v 0 200 0
v 80 200 0
v 80 0 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 1 0
vn 0 0 1
g floor
usemtl parquet
f 1/1/1 2/2/1 3/3/1 4/4/1
g sweethome3d_opening_on_hinge_1_door
usemtl bois
f -4//2 -3//2 -2//2
f -4//2 -2//2 -1//2
`;

const MTL = `newmtl parquet
Kd 1.0 0.9 0.8
map_Kd textures/Parquet.JPEG

newmtl bois
Kd 0.5 0.3 0.1
d 1.0
`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

test('le MTL donne couleur, opacité et texture', () => {
  const m = parseMtl(MTL);
  assert.deepEqual(m.get('parquet').color, [1, 0.9, 0.8]);
  assert.equal(m.get('parquet').map, 'textures/Parquet.JPEG');
  assert.equal(m.get('bois').opacity, 1);
});

test('une texture se retrouve quel que soit son chemin ou sa casse', () => {
  assert.equal(fileKey('textures\\Parquet.JPEG'), 'parquet.jpeg');
  assert.equal(fileKey('./a/b/Parquet.jpeg'), 'parquet.jpeg');
});

test('chaque groupe devient un nœud, nom compris', () => {
  const { json } = read(objToGlb(OBJ, MTL, new Map()).glb);
  assert.deepEqual(json.nodes.map((n) => n.name), ['floor', 'sweethome3d_opening_on_hinge_1_door']);
});

test('un quad devient deux triangles', () => {
  const { stats, glb } = objToGlb(OBJ, MTL, new Map());
  assert.equal(stats.triangles, 4, 'un quad pour le sol, deux triangles pour la porte');
  const { json, accessor } = read(glb);
  assert.equal(accessor(json.meshes[0].primitives[0].indices).length, 6);
});

test('les sommets répétés sont partagés', () => {
  // Le sol a quatre coins distincts : quatre sommets, pas six.
  const { json } = read(objToGlb(OBJ, MTL, new Map()).glb);
  const pos = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  assert.equal(pos.count, 4);
  assert.deepEqual(pos.min, [0, 0, 0]);
  assert.deepEqual(pos.max, [100, 0, 100]);
});

test('les indices négatifs pointent depuis la fin', () => {
  const { json, accessor } = read(objToGlb(OBJ, MTL, new Map()).glb);
  const door = json.meshes[1].primitives[0];
  const pos = accessor(door.attributes.POSITION);
  // Les quatre derniers sommets : la porte de 80 × 200.
  assert.equal(Math.max(...pos.filter((_, i) => i % 3 === 1)), 200);
  assert.equal(Math.max(...pos.filter((_, i) => i % 3 === 0)), 80);
});

test('le V des coordonnées de texture est retourné pour glTF', () => {
  const { json, accessor } = read(objToGlb(OBJ, MTL, new Map()).glb);
  const uv = accessor(json.meshes[0].primitives[0].attributes.TEXCOORD_0);
  // vt 0 0 en OBJ devient (0, 1) en glTF, dont l'origine est en haut.
  assert.deepEqual(uv.slice(0, 2), [0, 1]);
});

test('la texture fournie est embarquée et liée au matériau', () => {
  const images = new Map([['parquet.jpeg', { data: PNG, mime: 'image/png' }]]);
  const { glb, stats } = objToGlb(OBJ, MTL, images);
  const { json } = read(glb);
  assert.equal(stats.textures, 1);
  assert.equal(json.images.length, 1);
  const parquet = json.materials.find((m) => m.name === 'parquet');
  assert.equal(parquet.pbrMetallicRoughness.baseColorTexture.index, 0);
  assert.equal(json.samplers[0].wrapS, 10497, 'les textures se répètent');
});

test('une texture manquante est signalée, pas une erreur', () => {
  const { stats, glb } = objToGlb(OBJ, MTL, new Map());
  assert.deepEqual(stats.missingTextures, ['textures/Parquet.JPEG']);
  const { json } = read(glb);
  assert.equal(json.images, undefined);
  assert.deepEqual(json.materials.find((m) => m.name === 'parquet').pbrMetallicRoughness.baseColorFactor, [1, 0.9, 0.8, 1]);
});

test('sans MTL, la géométrie passe quand même', () => {
  const { stats } = objToGlb(OBJ, null, new Map());
  assert.equal(stats.triangles, 4);
  assert.equal(stats.groups, 2);
});

test('une transparence du MTL devient un mélange alpha', () => {
  const { json } = read(objToGlb('v 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl verre\nf 1 2 3\n', 'newmtl verre\nKd 1 1 1\nd 0.3\n', new Map()).glb);
  assert.equal(json.materials[0].alphaMode, 'BLEND');
  assert.equal(json.materials[0].pbrMetallicRoughness.baseColorFactor[3], 0.3);
});

test('les fins de ligne Windows sont acceptées', () => {
  const { stats } = objToGlb(OBJ.replace(/\n/g, '\r\n'), MTL.replace(/\n/g, '\r\n'), new Map());
  assert.equal(stats.triangles, 4);
});

test('un vantail Sweet Home 3D devient un nœud parent, gonds notés', () => {
  // Vantail de 80 × 200 en x/y ; gonds côté x = 80, poignée côté x = 5.
  const obj = [
    'v 0 0 0', 'v 80 0 0', 'v 80 200 0', 'v 0 200 0',
    'v 79 10 0', 'v 81 10 0', 'v 81 190 0',
    'v 4 100 1', 'v 6 100 1', 'v 6 104 1',
    'g frame', 'f 1 2 3',
    'g sweethome3d_hinge_1', 'f 5 6 7',
    'g sweethome3d_opening_on_hinge_1_door', 'f 1 2 3', 'f 1 3 4',
    'g sweethome3d_opening_on_hinge_1_handle', 'f 8 9 10',
    'g sofa', 'f 1 2 4',
  ].join('\n');
  const { glb, stats } = objToGlb(obj, null, new Map());
  const { json } = read(glb);
  assert.equal(stats.leaves, 1);
  const leafIdx = json.nodes.findIndex((n) => n.name === 'sweethome3d_leaf_0_1');
  const leaf = json.nodes[leafIdx];
  assert.deepEqual(leaf.children.map((c) => json.nodes[c].name),
    ['sweethome3d_opening_on_hinge_1_door', 'sweethome3d_opening_on_hinge_1_handle']);
  assert.equal(leaf.extras.owlnestLeaf.hinge, 'end');
  assert.equal(leaf.extras.owlnestLeaf.motion, 'hinge');
  const roots = json.scenes[0].nodes.map((i) => json.nodes[i].name);
  assert.deepEqual(roots, ['frame', 'sweethome3d_hinge_1', 'sofa', 'sweethome3d_leaf_0_1']);
});

test('une simplification écrit moins de triangles et retire les sommets orphelins', () => {
  const obj = ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'v 5 5 5', 'g deco', 'f 1 2 3', 'f 1 3 4', 'f 3 4 5'].join('\n');
  const { glb, stats } = objToGlb(obj, null, new Map(), {
    simplify: (group, idx) => (group === 'deco' ? idx.slice(0, 3) : null),
  });
  const { json, accessor } = read(glb);
  assert.equal(stats.triangles, 3);
  assert.equal(stats.trianglesOut, 1);
  const prim = json.meshes[0].primitives[0];
  assert.deepEqual(accessor(prim.indices), [0, 1, 2]);
  assert.equal(json.accessors[prim.attributes.POSITION].count, 3, 'le sommet (5,5,5) a disparu');
});
