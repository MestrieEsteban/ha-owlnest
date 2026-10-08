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

/** En dessous, fusionner ne rapporte rien. */
const MIN_GROUP = 2;

/** Un objet qui appartient à un ouvrant, ou que la carte a ajouté elle-même. */
function isMoving(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) {
    if (n.userData.owlnestPartId || n.userData.owlnestHelper || n.userData.owlnestBatch) return true;
  }
  return false;
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

/** Les attributs d'une géométrie, pour ne fusionner que des géométries compatibles. */
function signature(g: THREE.BufferGeometry): string {
  const attrs = Object.keys(g.attributes).sort()
    .map((k) => `${k}:${g.attributes[k].itemSize}:${(g.attributes[k] as THREE.BufferAttribute).normalized ? 'n' : ''}`);
  return `${attrs.join(',')}|${g.index ? 'i' : 'n'}`;
}

export class StaticBatch {
  private batches: THREE.Mesh[] = [];
  private hidden: THREE.Mesh[] = [];

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
      if (Array.isArray(mesh.material) || mesh.morphTargetInfluences?.length) return;
      if (isMoving(mesh, root)) return;
      const m = mesh.material as THREE.Material;
      const key = `${look(m)}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${signature(mesh.geometry)}`;
      const list = groups.get(key);
      if (list) list.push(mesh);
      else groups.set(key, [mesh]);
    });

    let replaced = 0;
    for (const meshes of groups.values()) {
      if (meshes.length < MIN_GROUP) continue;
      const geoms = meshes.map((mesh) => {
        const g = mesh.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
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
