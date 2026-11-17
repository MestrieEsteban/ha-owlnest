/**
 * batching.ts — regrouper les objets immobiles pour dessiner moins souvent.
 *
 * Un export Sweet Home 3D, c'est des centaines d'objets séparés : un par mur,
 * par meuble, par poignée. Le GPU les dessine un par un, et chaque appel coûte
 * surtout au processeur : sur une tablette, c'est ce qui fait chuter les images
 * par seconde quand la caméra tourne, bien plus que le nombre de triangles.
 * L'appartement de test : 817 appels par image.
 *
 * Tout ce qui ne bouge pas et partage un matériau peut être dessiné d'un seul
 * coup. On fusionne donc ces objets en une maille par matériau, et on cache
 * les originaux, sans les détruire :
 *
 *  - en édition, on revient aux originaux : on clique, on survole, on
 *    désigne des pièces, et tout cela repose sur les objets d'origine ;
 *  - un ouvrant n'est jamais fusionné : il bouge. Les pièces montées sous un
 *    pivot d'ouvrant restent à part, et on refusionne à chaque remontage.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WALL_ATTR, wallItemCode } from './plan/low-walls';

/** En dessous, fusionner ne rapporte rien. */
const MIN_GROUP = 2;

/** Un objet qui appartient à un ouvrant, que la carte a ajouté elle-même, ou qu'elle cache seul (murs bas). */
function isMoving(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) {
    if (n.userData.owlnestPartId || n.userData.owlnestAnimated || n.userData.owlnestHelper || n.userData.owlnestBatch || n.userData.owlnestLive) return true;
  }
  return false;
}

/** Porte-t-il quelque chose qui doit rester visible : un ouvrant, ou une maille qu'on ne fusionne pas ? */
function carriesSomething(mesh: THREE.Object3D, merged: Set<THREE.Object3D>): boolean {
  let found = false;
  const visit = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (found || !c.visible) continue;
      if (
        c.userData.owlnestPartId || c.userData.owlnestAnimated || c.userData.owlnestLive
        || ((c as THREE.Mesh).isMesh && !merged.has(c))
      ) { found = true; return; }
      visit(c);
    }
  };
  visit(mesh);
  return found;
}

/**
 * L'apparence d'un matériau. Un export Sweet Home 3D répète souvent le même
 * blanc ou le même bois sous des noms différents (243 matériaux pour 163
 * apparences sur l'appartement de test) : à apparence égale, un seul appel.
 */
function look(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  return [
    m.type, s.color?.getHexString() ?? '-', s.map?.source?.uuid ?? '-', s.emissive?.getHexString() ?? '-',
    m.opacity, m.transparent, m.side, m.alphaTest, m.vertexColors, s.roughness, s.metalness,
    s.normalMap?.source?.uuid ?? '-', m.blending, m.depthWrite,
  ].join('|');
}

/**
 * Les attributs d'une géométrie, pour ne fusionner que des géométries
 * compatibles. Le type n'y entre pas : tout repasse en flottants (`toFloat`).
 */
function signature(g: THREE.BufferGeometry): string {
  const attrs = Object.keys(g.attributes).sort().map((k) => `${k}:${g.attributes[k].itemSize}`);
  return `${attrs.join(',')}|${g.index ? 'i' : 'n'}`;
}

const COMPONENT = ['getX', 'getY', 'getZ', 'getW'] as const;

/**
 * Repasse les attributs quantifiés (KHR_mesh_quantization, voir l'optimiseur)
 * en flottants. Un entier normalisé ne sort pas de [-1, 1] : déplacé dans le
 * repère de la scène, il serait écrêté, et l'objet écrasé.
 */
function toFloat(g: THREE.BufferGeometry): void {
  for (const [name, attr] of Object.entries(g.attributes)) {
    const a = attr as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    if (a.array instanceof Float32Array && !a.normalized && !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
    const size = a.itemSize;
    const out = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < size; c++) out[i * size + c] = a[COMPONENT[c]](i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
}

const _box = new THREE.Box3();
const _center = new THREE.Vector3();

/** La cellule d'une maille, au sol : le regroupement spatial (optimiseur, A5). */
function cellOf(mesh: THREE.Mesh, cell: number): string {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  _box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).getCenter(_center);
  return `|c${Math.floor(_center.x / cell)},${Math.floor(_center.z / cell)}`;
}

/** Le mur auquel un meuble est adossé, pour les murs bas (voir plan/low-walls.ts). */
function wallItemOf(o: THREE.Object3D, root: THREE.Object3D): number | undefined {
  for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) {
    if (n.userData.owlnestWallItem !== undefined) return n.userData.owlnestWallItem as number;
  }
  return undefined;
}

export class StaticBatch {
  private batches: THREE.Mesh[] = [];
  private hidden: THREE.Mesh[] = [];

  /**
   * Taille des cellules en unités du modèle, ou 0 : une fusion par matériau et
   * par cellule plutôt que par matériau pour toute la maison. Plus d'appels au
   * total, mais la caméra n'en dessine que ce qu'elle voit.
   */
  cell = 0;

  constructor(private root: THREE.Object3D) {}

  get merged(): boolean {
    return this.batches.length > 0;
  }

  /** Fusionne ce qui peut l'être. Rend le nombre d'objets remplacés. */
  merge(): number {
    if (this.merged) return 0;
    const root = this.root;
    root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();

    const groups = new Map<string, THREE.Mesh[]>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
      // Déjà dessiné d'un seul appel (EXT_mesh_gpu_instancing, voir l'optimiseur).
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) return;
      if (Array.isArray(mesh.material) || mesh.morphTargetInfluences?.length) return;
      if (isMoving(mesh, root)) return;
      const m = mesh.material as THREE.Material;
      // Un meuble adossé à un mur reçoit le numéro de son mur : il disparaît avec
      // lui dans le shader, sans quitter le regroupement.
      const wall = wallItemOf(mesh, root) !== undefined ? '|w' : '';
      const cell = this.cell > 0 ? cellOf(mesh, this.cell) : '';
      const key = `${look(m)}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${signature(mesh.geometry)}${wall}${cell}`;
      const list = groups.get(key);
      if (list) list.push(mesh);
      else groups.set(key, [mesh]);
    });

    // Cacher un objet cache tout ce qu'il porte. Un objet qui porte un ouvrant
    // (son pivot est monté dessous) ou une maille restée à part garde donc sa
    // place : sinon la porte disparaît avec lui dès qu'on quitte l'édition.
    for (let changed = true; changed;) {
      changed = false;
      const kept = new Set<THREE.Object3D>();
      for (const list of groups.values()) if (list.length >= MIN_GROUP) list.forEach((m) => kept.add(m));
      for (const [key, list] of groups) {
        if (list.length < MIN_GROUP) continue;
        const free = list.filter((mesh) => !carriesSomething(mesh, kept));
        if (free.length !== list.length) { groups.set(key, free); changed = true; }
      }
    }

    let replaced = 0;
    for (const meshes of groups.values()) {
      if (meshes.length < MIN_GROUP) continue;
      const geoms = meshes.map((mesh) => {
        const g = mesh.geometry.clone();
        toFloat(g);
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
        const wall = wallItemOf(mesh, root);
        if (wall !== undefined) {
          g.setAttribute(WALL_ATTR, new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(wallItemCode(wall)), 1));
        }
        return g;
      });
      const merged = mergeGeometries(geoms, false);
      geoms.forEach((g) => g.dispose());
      if (!merged) continue;

      const first = meshes[0];
      const batch = new THREE.Mesh(merged, first.material);
      batch.name = 'owlnest_batch';
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      batch.renderOrder = first.renderOrder;
      batch.userData.owlnestBatch = true;
      // L'ombre choisie pour ses originaux (réglages, optimiseur), rejouée à chaud.
      batch.userData.owlnestCast = first.castShadow;
      root.add(batch);
      this.batches.push(batch);
      for (const mesh of meshes) {
        mesh.visible = false;
        this.hidden.push(mesh);
      }
      replaced += meshes.length;
    }
    return replaced;
  }

  /** Rend les objets d'origine et jette les fusions. */
  unmerge() {
    for (const b of this.batches) {
      b.removeFromParent();
      b.geometry.dispose();
    }
    for (const mesh of this.hidden) mesh.visible = true;
    this.batches = [];
    this.hidden = [];
  }
}
