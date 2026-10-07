import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clipRange, clipInfos, ClipRig, commonAncestor } from './parts-clips.mjs';
import { PartController } from './parts-runtime.mjs';

const T0 = 1 / 24;
const T1 = 41 / 24;
const Q_REST = [0, 0, 0, 1];
// Float32 des pistes : comparer à cette valeur, pas au double JS.
const q90y = [0, Math.fround(Math.SQRT1_2), 0, Math.fround(Math.SQRT1_2)];
const qRest = () => new THREE.Quaternion().fromArray(Q_REST);
const qOpen = () => new THREE.Quaternion().fromArray(q90y);
/** three normalise le quaternion à l'écriture : l'angle n'est jamais exactement 0. */
const NEAR = 2e-3;

function reclineClip(name = 'Reclinar_Der', node = 'Mecanismo_Der001') {
  return new THREE.AnimationClip(name, T1, [
    new THREE.QuaternionKeyframeTrack(
      `${node}.quaternion`,
      [T0, T1],
      [...Q_REST, ...q90y],
    ),
  ]);
}

function sofa() {
  const root = new THREE.Group();
  root.name = 'Scene';
  const sofa = new THREE.Group();
  sofa.name = 'Sofa';
  const left = new THREE.Group();
  left.name = 'Mecanismo_Izq001';
  const right = new THREE.Group();
  right.name = 'Mecanismo_Der001';
  const head = new THREE.Group();
  head.name = 'Cabezal_Der001';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial());
  mesh.name = 'tela_der';
  const meshL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial());
  meshL.name = 'tela_izq';
  right.add(mesh);
  left.add(meshL);
  sofa.add(left, right, head);
  root.add(sofa);
  root.animations = [
    reclineClip(),
    reclineClip('Cabezal_Der', 'Cabezal_Der001'),
    reclineClip('Reclinar_Izq', 'Mecanismo_Izq001'),
  ];
  return { root, sofa, left, right, head, mesh, meshL };
}

function settle(c) {
  let guard = 0;
  while (c.update(0.1) && guard++ < 100);
}

const ANIM = {
  id: 'a1', entity: 'cover.sofa', mesh: 'tela_der', triangle: 0,
  motion: 'animation', clips: ['Reclinar_Der'], duration: 1,
};

test('clipRange ignore le début à 0 que Blender n’écrit pas', () => {
  const clip = reclineClip();
  const [start, end] = clipRange(clip);
  assert.ok(Math.abs(start - T0) < 1e-6);
  assert.ok(Math.abs(end - T1) < 1e-6);
  assert.ok(Math.abs((end - start) - (T1 - T0)) < 1e-6);
});

test('clipInfos liste les nœuds animés sans doublon', () => {
  const info = clipInfos([reclineClip()]);
  assert.equal(info.length, 1);
  assert.equal(info[0].name, 'Reclinar_Der');
  assert.deepEqual(info[0].nodes, ['Mecanismo_Der001']);
  assert.ok(Math.abs(info[0].duration - (T1 - T0)) < 1e-6);
});

test('ClipRig pose une fraction et restore la pose de repos', () => {
  const { root, right } = sofa();
  const rest = right.quaternion.clone();
  const rig = new ClipRig(root, root.animations, ['Reclinar_Der']);
  assert.deepEqual(rig.missing, []);
  assert.equal(rig.nodes[0], right);

  rig.set(0);
  assert.ok(right.quaternion.angleTo(qRest()) < NEAR);

  rig.set(1);
  assert.ok(right.quaternion.angleTo(qOpen()) < NEAR);

  rig.set(0.4);
  const mid = qRest().slerp(qOpen(), 0.4);
  assert.ok(right.quaternion.angleTo(mid) < NEAR);

  rig.restore();
  assert.ok(right.quaternion.angleTo(rest) < NEAR);
});

test('ClipRig signale une animation absente et ignore un nœud introuvable', () => {
  const { root } = sofa();
  const ghost = new THREE.AnimationClip('Orpheline', 1, [
    new THREE.QuaternionKeyframeTrack('NullePart.quaternion', [0, 1], [...Q_REST, ...q90y]),
  ]);
  const rig = new ClipRig(root, [...root.animations, ghost], ['Absente', 'Orpheline']);
  assert.deepEqual(rig.missing, ['Absente']);
  assert.equal(rig.nodes.length, 0);
});

test('commonAncestor s’arrête avant la racine du modèle', () => {
  const { root, sofa: sofaNode, left, right } = sofa();
  assert.equal(commonAncestor([left, right], root), sofaNode);
  assert.equal(commonAncestor([right], root), right);
  assert.equal(commonAncestor([sofaNode, right], root), sofaNode);
  const other = new THREE.Group();
  other.name = 'Mur';
  root.add(other);
  assert.equal(commonAncestor([right, other], root), right, 'LCA = racine : on garde le premier nœud');
  assert.equal(commonAncestor([], root), null);
});

test('PartController pose les animations d’après la position de l’entité', () => {
  const { root, right, mesh } = sofa();
  const c = new PartController();
  const res = c.build(root, [ANIM]);
  assert.equal(res.ok, 1);
  assert.deepEqual(res.missing, []);
  assert.equal(c.count, 1);
  assert.equal(c.objectOf('a1'), right);
  assert.equal(c.animatedOwnerOf(right), 'a1');
  assert.equal(c.animatedOwnerOf(mesh), 'a1');

  assert.equal(c.applyStates({ 'cover.sofa': { state: 'open', attributes: { current_position: 40 } } }), true);
  settle(c);
  const mid = qRest().slerp(qOpen(), 0.4);
  assert.ok(right.quaternion.angleTo(mid) < NEAR);

  c.dispose(root);
  assert.ok(right.quaternion.angleTo(qRest()) < NEAR);
});

test('invert et aperçu avancent la même course', () => {
  const { root, right } = sofa();
  const c = new PartController();
  c.build(root, [{ ...ANIM, invert: true }]);
  c.applyStates({ 'cover.sofa': { state: 'open', attributes: { current_position: 0 } } });
  settle(c);
  assert.ok(right.quaternion.angleTo(qOpen()) < NEAR,
    'fermé à 0 % inversé = dernière image clé');

  c.preview('a1', 0);
  settle(c);
  assert.ok(right.quaternion.angleTo(qRest()) < NEAR);
});

test('une animation manquante reste montée pour que l’éditeur puisse en choisir une autre', () => {
  const { root } = sofa();
  const c = new PartController();
  const res = c.build(root, [{ ...ANIM, clips: ['RenommeeDansBlender'] }]);
  assert.equal(res.ok, 0);
  assert.equal(res.missing.length, 1);
  assert.equal(c.count, 1);
  assert.equal(c.hasTarget({ ...ANIM, clips: ['RenommeeDansBlender'] }), true);
});

test('configure passe d’un battant aux animations sans recharger le modèle', () => {
  const { root, right } = sofa();
  const c = new PartController();
  c.build(root, [{
    id: 'a1', entity: 'cover.sofa', mesh: 'tela_der', triangle: 0,
    node: 'Sofa', nodeIndex: 0, motion: 'swing', hinge: 'start', angle: 90, duration: 1,
  }]);
  assert.ok(c.objectOf('a1'));
  assert.equal(c.configure({ ...ANIM, node: 'Sofa', nodeIndex: 0 }), true);
  // Une seule piste : l'objet surligné est le mécanisme, pas le canapé.
  assert.equal(c.objectOf('a1'), right);
  c.preview('a1', 1);
  settle(c);
  assert.ok(right.quaternion.angleTo(qOpen()) < NEAR);

  assert.equal(c.configure({
    id: 'a1', entity: 'cover.sofa', mesh: 'tela_der', triangle: 0,
    node: 'Sofa', nodeIndex: 0, motion: 'swing', hinge: 'start', angle: 90, duration: 1,
  }), true);
  assert.ok(right.quaternion.angleTo(qRest()) < NEAR,
    'retour au battant : pose de repos d’abord');
});

test('plusieurs animations d’un même ouvrant avancent ensemble', () => {
  const { root, left, right, sofa: sofaNode } = sofa();
  const c = new PartController();
  c.build(root, [{ ...ANIM, clips: ['Reclinar_Der', 'Reclinar_Izq'] }]);
  assert.equal(c.objectOf('a1'), sofaNode);
  c.preview('a1', 1);
  settle(c);
  const open = qOpen();
  assert.ok(right.quaternion.angleTo(open) < NEAR);
  assert.ok(left.quaternion.angleTo(open) < NEAR);
});

test('deux ouvrants à animations coexistent et gardent des poses indépendantes', () => {
  const { root, sofa: sofaNode, left, right, head, mesh, meshL } = sofa();
  const c = new PartController();
  const rightPart = {
    ...ANIM, id: 'right', entity: 'cover.der',
    clips: ['Reclinar_Der', 'Cabezal_Der'],
  };
  const leftPart = {
    ...ANIM, id: 'left', entity: 'cover.izq', mesh: 'tela_izq',
    clips: ['Reclinar_Izq'],
  };
  const res = c.build(root, [rightPart, leftPart]);
  assert.equal(res.ok, 2);
  assert.deepEqual(res.missing, []);
  assert.equal(c.count, 2);

  // Le parent commun sert au surlignage, pas à s'approprier l'autre côté.
  assert.equal(c.objectOf('right'), sofaNode);
  assert.equal(c.animatedOwnerOf(right), 'right');
  assert.equal(c.animatedOwnerOf(head), 'right');
  assert.equal(c.animatedOwnerOf(mesh), 'right');
  assert.equal(c.animatedOwnerOf(left), 'left');
  assert.equal(c.animatedOwnerOf(meshL), 'left');
  assert.equal(c.animatedOwnerOf(sofaNode), null);

  c.applyStates({
    'cover.der': { state: 'open', attributes: { current_position: 100 } },
    'cover.izq': { state: 'closed', attributes: { current_position: 0 } },
  });
  settle(c);
  const open = qOpen();
  const rest = qRest();
  assert.ok(right.quaternion.angleTo(open) < NEAR);
  assert.ok(head.quaternion.angleTo(open) < NEAR);
  assert.ok(left.quaternion.angleTo(rest) < NEAR);

  c.applyStates({
    'cover.der': { state: 'open', attributes: { current_position: 0 } },
    'cover.izq': { state: 'open', attributes: { current_position: 100 } },
  });
  settle(c);
  assert.ok(right.quaternion.angleTo(rest) < NEAR);
  assert.ok(head.quaternion.angleTo(rest) < NEAR);
  assert.ok(left.quaternion.angleTo(open) < NEAR);
});
