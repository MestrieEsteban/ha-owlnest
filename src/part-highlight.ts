/**
 * part-highlight.ts — surlignage de l'éditeur d'ouvrants, façon Blender.
 *
 * Survoler une ligne de l'arborescence, ou la sélectionner, teinte l'objet
 * correspondant dans la vue. Rien n'est modifié sur le modèle : chaque maille
 * concernée reçoit un enfant qui partage sa géométrie et se dessine par-dessus,
 * sans test de profondeur — une porte cachée derrière un mur reste repérable.
 *
 * Les enfants suivent donc l'objet quand l'aperçu l'anime, et disparaissent
 * avec lui si le modèle est rechargé.
 */
import * as THREE from 'three';

/** `follower` : objets entraînés par l'arête mobile d'un déroulant. */
export type HighlightSlot = 'hover' | 'selected' | 'follower';

/** Ce qu'il faut surligner : un sous-arbre entier, ou quelques triangles d'une maille. */
export type HighlightSource =
  | { object: THREE.Object3D }
  | { mesh: THREE.Mesh; tris: ArrayLike<number> };

const STYLE: Record<HighlightSlot, { color: number; opacity: number; order: number }> = {
  // Orange de sélection de Blender ; le survol, plus pâle, reste en dessous.
  selected: { color: 0xff8c1a, opacity: 0.45, order: 1001 },
  hover: { color: 0xffe0a0, opacity: 0.3, order: 1000 },
  // Dessiné par-dessus la sélection : un suiveur est souvent l'enfant de l'objet choisi.
  follower: { color: 0x38bdf8, opacity: 0.55, order: 1002 },
};

const noRaycast = () => {};

export class PartHighlight {
  private overlays: Record<HighlightSlot, THREE.Mesh[]> = { hover: [], selected: [], follower: [] };
  private materials: Partial<Record<HighlightSlot, THREE.MeshBasicMaterial>> = {};

  private _material(slot: HighlightSlot): THREE.MeshBasicMaterial {
    let m = this.materials[slot];
    if (!m) {
      const s = STYLE[slot];
      m = new THREE.MeshBasicMaterial({
        color: s.color, transparent: true, opacity: s.opacity,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      });
      this.materials[slot] = m;
    }
    return m;
  }

  private _overlay(slot: HighlightSlot, host: THREE.Mesh, geometry: THREE.BufferGeometry, owned: boolean) {
    const o = new THREE.Mesh(geometry, this._material(slot));
    o.name = '__owlnest_highlight';
    o.userData.owlnestHelper = true;
    o.userData.ownedGeometry = owned;
    o.renderOrder = STYLE[slot].order;
    o.raycast = noRaycast;
    o.castShadow = false;
    o.receiveShadow = false;
    host.add(o);
    this.overlays[slot].push(o);
  }

  /** Remplace le surlignage d'un emplacement. Retourne le nombre de mailles teintées. */
  show(slot: HighlightSlot, sources: HighlightSource[]): number {
    this.clear(slot);
    for (const src of sources) {
      if ('object' in src) {
        const meshes: THREE.Mesh[] = [];
        src.object.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !m.userData.owlnestHelper) meshes.push(m);
        });
        // La géométrie est partagée : aucune copie, même pour un groupe entier.
        for (const m of meshes) this._overlay(slot, m, m.geometry, false);
      } else {
        const g = pieceGeometry(src.mesh, src.tris);
        if (g) this._overlay(slot, src.mesh, g, true);
      }
    }
    return this.overlays[slot].length;
  }

  clear(slot?: HighlightSlot) {
    for (const s of slot ? [slot] : (['hover', 'selected', 'follower'] as const)) {
      for (const o of this.overlays[s]) {
        o.parent?.remove(o);
        if (o.userData.ownedGeometry) o.geometry.dispose();
      }
      this.overlays[s] = [];
    }
  }

  /** Nombre de mailles teintées, pour les tests. */
  count(slot: HighlightSlot): number {
    return this.overlays[slot].length;
  }

  dispose() {
    this.clear();
    for (const m of Object.values(this.materials)) m?.dispose();
    this.materials = {};
  }
}

/**
 * Géométrie d'une poignée de triangles, positions seules.
 *
 * Copiée plutôt que partagée : un index propre sur les attributs de la maille
 * libérerait, à sa destruction, les tampons que la maille utilise encore.
 */
function pieceGeometry(mesh: THREE.Mesh, tris: ArrayLike<number>): THREE.BufferGeometry | null {
  const src = mesh.geometry.getAttribute('position');
  if (!src || !tris.length) return null;
  const index = mesh.geometry.getIndex();
  const out = new Float32Array(tris.length * 9);
  let w = 0;
  for (let i = 0; i < tris.length; i++) {
    for (let c = 0; c < 3; c++) {
      const vi = index ? index.getX(tris[i] * 3 + c) : tris[i] * 3 + c;
      out[w++] = src.getX(vi); out[w++] = src.getY(vi); out[w++] = src.getZ(vi);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return g;
}
