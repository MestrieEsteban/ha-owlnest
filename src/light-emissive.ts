/**
 * light-emissive.ts — émisivité des meshes hôtes d'une ancre lumière.
 *
 * Les matériaux du modèle sont souvent partagés : on clone, on ne mute jamais
 * l'original. Couleur = celle résolue pour la Point/Spot (`entry.targetColor`) ;
 * l'intensité suit le niveau × brillance HA.
 * Un mesh déjà porté par un ouvrant (`owlnestPartId`) est ignoré.
 */
import * as THREE from 'three';
import type { AnchorEntry, Hass, LightHostRef } from './types';
import { describeEntity } from './entities/descriptors';
import {
  DEFAULT_EMISSIVE_LEVEL, hasLightHost, listLightHosts, type LightHostFields,
} from './light-fields';
import { stampOrder, meshRankOf } from './model-outline';

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  stampOrder(root);
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const r = meshRankOf(o);
    if (r !== undefined) out[r] = o as THREE.Mesh;
  });
  return out.filter(Boolean);
}

type EmissiveMat = THREE.Material & {
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

/** Intensité d'émisivité : niveau × (brillance HA si lié, sinon 1). */
export function emissiveIntensity(
  level: number,
  brightness01: number,
  link: boolean,
): number {
  const l = Math.min(1, Math.max(0, Number.isFinite(level) ? level : DEFAULT_EMISSIVE_LEVEL));
  const b = Math.min(1, Math.max(0, Number.isFinite(brightness01) ? brightness01 : 0));
  return l * (link ? b : 1);
}

/** Copie → original, pour libérer sans toucher un matériau encore partagé. */
const origins = new WeakMap<THREE.Material, THREE.Material>();

function cloneMaterial(src: THREE.Material): THREE.Material {
  const copy = src.clone();
  if (Object.prototype.hasOwnProperty.call(src, 'onBeforeCompile')) copy.onBeforeCompile = src.onBeforeCompile;
  if (Object.prototype.hasOwnProperty.call(src, 'customProgramCacheKey')) {
    copy.customProgramCacheKey = src.customProgramCacheKey;
  }
  origins.set(copy, src);
  return copy;
}

interface Entry {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
}

/** Émisivité clonée sur les mailles d'un hôte. */
class HostEmissive {
  private entries: Entry[] | null = null;
  private copies = new Map<THREE.Material, THREE.Material>();
  private last = '';

  constructor(private readonly target: THREE.Object3D) {}

  apply(intensity: number, color: THREE.Color): boolean {
    const i = Math.min(1, Math.max(0, intensity));
    const key = `${color.getHexString()}:${i.toFixed(4)}`;
    if (this.entries && key === this.last) return false;
    this.last = key;
    if (!this.entries) this._mount();
    for (const copy of this.copies.values()) {
      const m = copy as EmissiveMat;
      if (m.emissive?.isColor) {
        m.emissive.copy(color);
        m.emissiveIntensity = i;
      }
    }
    return true;
  }

  restore() {
    if (!this.entries) return;
    for (const { mesh, original } of this.entries) mesh.material = original;
    for (const copy of this.copies.values()) copy.dispose();
    this.copies.clear();
    this.entries = null;
    this.last = '';
  }

  private _mount() {
    const entries: Entry[] = [];
    const copyOf = (m: THREE.Material) => {
      let c = this.copies.get(m);
      if (!c) { c = cloneMaterial(m); this.copies.set(m, c); }
      return c;
    };
    this.target.traverse((o) => {
      if (o.userData.owlnestHelper) return;
      if (o !== this.target && o.userData.owlnestPartId) return;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const original = mesh.material;
      entries.push({ mesh, original });
      mesh.material = Array.isArray(original) ? original.map(copyOf) : copyOf(original);
    });
    this.entries = entries;
  }
}

/** Centre monde d'un hôte (boîte englobante). */
export function lightHostCenter(host: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
  const box = new THREE.Box3().setFromObject(host);
  if (box.isEmpty()) {
    host.getWorldPosition(out);
    return out;
  }
  return box.getCenter(out);
}

/** Centre de la boîte englobante combinée de plusieurs hôtes. */
export function lightHostsCenter(hosts: THREE.Object3D[], out = new THREE.Vector3()): THREE.Vector3 {
  if (hosts.length === 0) return out.set(0, 0, 0);
  if (hosts.length === 1) return lightHostCenter(hosts[0], out);
  const box = new THREE.Box3();
  for (const h of hosts) {
    const b = new THREE.Box3().setFromObject(h);
    if (!b.isEmpty()) box.union(b);
  }
  if (box.isEmpty()) return lightHostCenter(hosts[0], out);
  return box.getCenter(out);
}

/** Résout un mesh hôte depuis une réf. */
export function resolveLightHostRef(
  root: THREE.Object3D,
  ref: LightHostRef,
): THREE.Object3D | null {
  const meshes = meshesOf(root);
  if (ref.meshIndex !== undefined) {
    const byIdx = meshes[ref.meshIndex];
    if (byIdx && (!ref.mesh || byIdx.name === ref.mesh || !byIdx.name)) return byIdx;
  }
  if (ref.mesh) {
    const byName = meshes.find((m) => m.name === ref.mesh);
    if (byName) return byName;
  }
  return null;
}

/** Résout le premier hôte (API historique). */
export function resolveLightHost(
  root: THREE.Object3D,
  fields: LightHostFields,
): THREE.Object3D | null {
  const hosts = resolveLightHosts(root, fields);
  return hosts[0] ?? null;
}

/** Tous les hôtes résolus, ouvrants exclus. */
export function resolveLightHosts(
  root: THREE.Object3D,
  fields: LightHostFields,
): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const seen = new Set<THREE.Object3D>();
  for (const ref of listLightHosts(fields)) {
    const host = resolveLightHostRef(root, ref);
    if (!host || hostIsOpeningPiece(host) || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

/**
 * L'objet porte-t-il déjà un ouvrant ? Dans ce cas on n'applique pas
 * l'émisivité lumière (PartTint / matériaux clonés de l'ouvrant priment).
 */
export function hostIsOpeningPiece(host: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = host; n; n = n.parent) {
    if (n.userData.owlnestPartId) return true;
  }
  return false;
}

interface Live {
  host: THREE.Object3D;
  emissive: HostEmissive;
}

/**
 * Applique / retire l'émisivité des ancres lumière et marque les hôtes
 * `owlnestLive` pour que le batching ne les fusionne pas.
 */
export class LightEmissiveController {
  /** Clé `anchorId#uuid` → instance. */
  private lives = new Map<string, Live>();
  private marked = new Set<THREE.Object3D>();

  /** Pose `owlnestLive` sur les hôtes avant un merge (sans toucher aux matériaux). */
  markHosts(root: THREE.Object3D, anchors: Iterable<AnchorEntry>) {
    this._clearMarks();
    for (const entry of anchors) {
      if (entry.domain !== 'light' || !hasLightHost(entry)) continue;
      for (const host of resolveLightHosts(root, entry)) {
        host.userData.owlnestLive = true;
        this.marked.add(host);
      }
    }
  }

  /**
   * Synchronise l'émisivité avec l'état HA.
   * Retourne `true` si l'apparence a changé.
   */
  sync(
    root: THREE.Object3D | null,
    anchors: Map<string, AnchorEntry>,
    hass: Hass | null,
  ): boolean {
    if (!root) { this.dispose(); return false; }
    let changed = false;
    const keep = new Set<string>();

    anchors.forEach((entry, key) => {
      if (entry.domain !== 'light' || entry.hidden || !hasLightHost(entry)) return;
      const hosts = resolveLightHosts(root, entry);
      if (!hosts.length) return;

      const state = hass?.states[entry.entityId];
      const brightness = state ? describeEntity(entry.entityId).level(state) : 0;
      const level = entry.emissiveLevel ?? DEFAULT_EMISSIVE_LEVEL;
      const link = entry.linkEmissiveBrightness !== false;
      const intensity = entry.hidden ? 0 : emissiveIntensity(level, brightness, link);

      for (const host of hosts) {
        const liveKey = `${key}#${host.uuid}`;
        keep.add(liveKey);
        let live = this.lives.get(liveKey);
        if (!live || live.host !== host) {
          if (live) { live.emissive.restore(); changed = true; }
          host.userData.owlnestLive = true;
          this.marked.add(host);
          live = { host, emissive: new HostEmissive(host) };
          this.lives.set(liveKey, live);
          changed = true;
        }
        if (live.emissive.apply(intensity, entry.targetColor)) changed = true;
      }
    });

    for (const [liveKey, live] of [...this.lives]) {
      if (keep.has(liveKey)) continue;
      live.emissive.restore();
      this.lives.delete(liveKey);
      changed = true;
    }
    return changed;
  }

  dispose() {
    for (const live of this.lives.values()) live.emissive.restore();
    this.lives.clear();
    this._clearMarks();
  }

  private _clearMarks() {
    for (const o of this.marked) {
      let still = false;
      for (const live of this.lives.values()) {
        if (live.host === o) { still = true; break; }
      }
      if (!still) delete o.userData.owlnestLive;
    }
    this.marked.clear();
    for (const live of this.lives.values()) {
      live.host.userData.owlnestLive = true;
      this.marked.add(live.host);
    }
  }
}
