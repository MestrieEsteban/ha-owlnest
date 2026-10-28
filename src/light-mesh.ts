/**
 * light-mesh.ts — approximation « forme d'objet » via RectAreaLight.
 *
 * Three.js n'a pas de MeshAreaLight arbitraire : chaque hôte GLB reçoit un
 * rectangle aligné sur sa boîte locale (deux plus grands axes = largeur/hauteur,
 * le plus mince = normale d'émission).
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { AnchorEntry } from './types';
import { hostIsOpeningPiece, lightHostsCenter } from './light-emissive';

let libReady = false;

/** À appeler une fois avant d'ajouter des RectAreaLight à la scène. */
export function ensureRectAreaLightLib(): void {
  if (libReady) return;
  RectAreaLightUniformsLib.init();
  libReady = true;
}

export interface MeshRectPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  width: number;
  height: number;
}

const _size = new THREE.Vector3();
const _box = new THREE.Box3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Pose d'un RectAreaLight pour un hôte : centre monde, orientation telle que
 * le plan XY du rectangle suit les deux plus grands axes locaux, −Z = axe mince.
 */
export function meshRectPose(host: THREE.Object3D): MeshRectPose {
  host.updateWorldMatrix(true, false);
  host.matrixWorld.decompose(_pos, _quat, _scl);

  let sx = 0;
  let sy = 0;
  let sz = 0;
  const mesh = host as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) {
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!;
    sx = Math.max(1e-4, (bb.max.x - bb.min.x) * Math.abs(_scl.x));
    sy = Math.max(1e-4, (bb.max.y - bb.min.y) * Math.abs(_scl.y));
    sz = Math.max(1e-4, (bb.max.z - bb.min.z) * Math.abs(_scl.z));
    // Centre géométrique local → monde
    _pos.set(
      (bb.min.x + bb.max.x) * 0.5,
      (bb.min.y + bb.max.y) * 0.5,
      (bb.min.z + bb.max.z) * 0.5,
    ).applyMatrix4(host.matrixWorld);
  } else {
    _box.setFromObject(host);
    _box.getCenter(_pos);
    _box.getSize(_size);
    sx = Math.max(1e-4, _size.x);
    sy = Math.max(1e-4, _size.y);
    sz = Math.max(1e-4, _size.z);
  }

  // Axes locaux unitaires en monde (échelle retirée).
  _x.set(1, 0, 0).transformDirection(host.matrixWorld);
  _y.set(0, 1, 0).transformDirection(host.matrixWorld);
  _z.set(0, 0, 1).transformDirection(host.matrixWorld);

  const dims: { s: number; axis: THREE.Vector3 }[] = [
    { s: sx, axis: _x.clone() },
    { s: sy, axis: _y.clone() },
    { s: sz, axis: _z.clone() },
  ].sort((a, b) => b.s - a.s);

  const width = dims[0].s;
  const height = dims[1].s;
  // RectAreaLight émet vers −Z local : on aligne −Z sur l'axe le plus mince.
  const n = dims[2].axis.clone().normalize();
  const wAxis = dims[0].axis.clone().normalize();
  // Orthonormaliser : Y = N × W, puis W = Y × N
  const yAxis = new THREE.Vector3().crossVectors(n, wAxis);
  if (yAxis.lengthSq() < 1e-10) {
    yAxis.crossVectors(n, Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
  }
  yAxis.normalize();
  wAxis.crossVectors(yAxis, n).normalize();
  // Colonnes = X, Y, Z locaux du light (Z = −n car émission vers −Z).
  _m.makeBasis(wAxis, yAxis, n.clone().negate());
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(_m);

  return {
    position: _pos.clone(),
    quaternion,
    width,
    height,
  };
}

/** Une RectAreaLight par hôte, déjà ajoutée à la scène. */
export function makeMeshAreaLights(
  hosts: THREE.Object3D[],
  scene: THREE.Scene,
): THREE.RectAreaLight[] {
  ensureRectAreaLightLib();
  const out: THREE.RectAreaLight[] = [];
  for (const host of hosts) {
    if (hostIsOpeningPiece(host)) continue;
    const pose = meshRectPose(host);
    const light = new THREE.RectAreaLight(0xffffff, 0, pose.width, pose.height);
    light.position.copy(pose.position);
    light.quaternion.copy(pose.quaternion);
    light.visible = false;
    scene.add(light);
    out.push(light);
  }
  return out;
}

/** Repose les RectAreaLights sur les hôtes (rebuild / configure). */
export function poseMeshAreaLights(
  lights: THREE.RectAreaLight[],
  hosts: THREE.Object3D[],
): void {
  const usable = hosts.filter((h) => !hostIsOpeningPiece(h));
  const n = Math.min(lights.length, usable.length);
  for (let i = 0; i < n; i++) {
    const pose = meshRectPose(usable[i]);
    lights[i].position.copy(pose.position);
    lights[i].quaternion.copy(pose.quaternion);
    lights[i].width = pose.width;
    lights[i].height = pose.height;
  }
}

/** Toutes les lumières 3D d'une ancre (primaire + extras + mesh). */
export function castLightsOf(
  entry: Pick<AnchorEntry, 'light' | 'extraLights' | 'meshLights'>,
): Array<THREE.PointLight | THREE.SpotLight | THREE.RectAreaLight> {
  const out: Array<THREE.PointLight | THREE.SpotLight | THREE.RectAreaLight> = [];
  const seen = new Set<THREE.Light>();
  const add = (l: THREE.PointLight | THREE.SpotLight | THREE.RectAreaLight | null | undefined) => {
    if (!l || seen.has(l)) return;
    seen.add(l);
    out.push(l);
  };
  add(entry.light);
  for (const l of entry.extraLights ?? []) add(l);
  for (const l of entry.meshLights ?? []) add(l);
  return out;
}

export function disposeEntryLights(entry: AnchorEntry, scene: THREE.Scene): void {
  for (const light of castLightsOf(entry)) {
    scene.remove(light);
    light.dispose();
  }
  entry.light = null;
  entry.extraLights = undefined;
  entry.meshLights = undefined;
  if (entry.lightTarget) {
    scene.remove(entry.lightTarget);
    entry.lightTarget = undefined;
  }
  if (entry.extraLightTargets?.length) {
    for (const t of entry.extraLightTargets) scene.remove(t);
    entry.extraLightTargets = undefined;
  }
}

/** Cibles Spot de l'ancre (primaire + extras). */
export function castLightTargetsOf(entry: AnchorEntry): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  if (entry.lightTarget) out.push(entry.lightTarget);
  if (entry.extraLightTargets?.length) out.push(...entry.extraLightTargets);
  return out;
}

/** Centre marqueur pour style mesh (AABB combinée). */
export function meshLightsAnchorPos(hosts: THREE.Object3D[]): THREE.Vector3 {
  return lightHostsCenter(hosts.filter((h) => !hostIsOpeningPiece(h)));
}
