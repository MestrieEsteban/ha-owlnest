/**
 * part-tint.ts — teinte d'un ouvrant selon son état, fermé ou ouvert.
 *
 * Les matériaux d'un modèle sont très souvent partagés : la même peinture sert
 * aux murs et aux portes. On ne touche donc jamais à l'original ; les mailles de
 * l'ouvrant reçoivent des copies, créées à la première teinte et rendues dès que
 * plus aucune couleur n'est demandée.
 */
import * as THREE from 'three';

/** Part de la couleur propre du matériau remplacée par la teinte, à plein effet. */
const COLOR_MIX = 0.55;
/** Lueur ajoutée : garde la teinte lisible sur une face à l'ombre. */
const GLOW = 0.35;

const HEX = /^#[0-9a-f]{6}$/i;

/** Couleur valide, ou `undefined` : une valeur malformée vaut « pas de teinte ». */
export function tintColor(value: string | undefined): string | undefined {
  return value && HEX.test(value) ? value : undefined;
}

/**
 * Teinte à appliquer pour une fraction d'ouverture.
 *
 * Deux couleurs : fondu de l'une à l'autre, à plein effet. Une seule : elle
 * s'estompe vers l'état sans couleur. Aucune : `null`.
 */
export function tintAt(
  closed: string | undefined,
  open: string | undefined,
  fraction: number,
): { color: THREE.Color; weight: number } | null {
  const c = tintColor(closed);
  const o = tintColor(open);
  const f = Math.min(1, Math.max(0, fraction));
  if (c && o) return { color: new THREE.Color(c).lerp(new THREE.Color(o), f), weight: 1 };
  if (c) return { color: new THREE.Color(c), weight: 1 - f };
  if (o) return { color: new THREE.Color(o), weight: f };
  return null;
}

/** Copie → original, pour qu'une pièce détachée d'une maille teinte reparte de l'original. */
const origins = new WeakMap<THREE.Material, THREE.Material>();

export function untinted<M extends THREE.Material | THREE.Material[]>(material: M): M {
  if (Array.isArray(material)) return material.map((m) => origins.get(m) ?? m) as M;
  return (origins.get(material as THREE.Material) ?? material) as M;
}

type Colored = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

function cloneMaterial(src: THREE.Material): THREE.Material {
  const copy = src.clone();
  // `clone()` ignore ces deux méthodes : sans elles, le découpage de cutaway.ts
  // disparaîtrait de la copie, marquée pourtant comme déjà instrumentée.
  if (Object.prototype.hasOwnProperty.call(src, 'onBeforeCompile')) copy.onBeforeCompile = src.onBeforeCompile;
  if (Object.prototype.hasOwnProperty.call(src, 'customProgramCacheKey')) {
    copy.customProgramCacheKey = src.customProgramCacheKey;
  }
  origins.set(copy, src);
  return copy;
}

function paint(copy: THREE.Material, src: THREE.Material, color: THREE.Color, weight: number) {
  const d = copy as Colored;
  const s = src as Colored;
  if (d.color?.isColor && s.color) d.color.copy(s.color).lerp(color, COLOR_MIX * weight);
  if (d.emissive?.isColor && s.emissive) {
    const base = s.emissiveIntensity ?? 1;
    d.emissive.copy(s.emissive).multiplyScalar(base).lerp(color.clone().multiplyScalar(GLOW), weight);
    d.emissiveIntensity = 1;
  }
}

interface Entry {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
}

/**
 * Teinte des mailles d'un ouvrant.
 *
 * `ownerId` borne le parcours : un nœud animé peut contenir le pivot d'une
 * autre pièce détachée, qui porte sa propre teinte.
 */
export class PartTint {
  private entries: Entry[] | null = null;
  private copies = new Map<THREE.Material, THREE.Material>();
  private last = '';

  constructor(private readonly target: THREE.Object3D, private readonly ownerId: string) {}

  /** Teinte-t-il quelque chose en ce moment ? */
  get active(): boolean { return this.entries !== null; }

  /** Applique la teinte. Retourne `true` si l'apparence a changé. */
  apply(closed: string | undefined, open: string | undefined, fraction: number): boolean {
    const tint = tintAt(closed, open, fraction);
    if (!tint) {
      const had = this.active;
      this.restore();
      return had;
    }
    const key = `${tint.color.getHexString()}:${tint.weight.toFixed(4)}`;
    if (this.entries && key === this.last) return false;
    this.last = key;
    if (!this.entries) this._mount();
    for (const [src, copy] of this.copies) paint(copy, src, tint.color, tint.weight);
    return true;
  }

  /** Rend aux mailles leurs matériaux d'origine et libère les copies. */
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
    const walk = (o: THREE.Object3D) => {
      if (o.userData.owlnestHelper) return;
      const owner = o.userData.owlnestPartId;
      if (o !== this.target && owner !== undefined && owner !== this.ownerId) return;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const original = mesh.material;
        entries.push({ mesh, original });
        mesh.material = Array.isArray(original) ? original.map(copyOf) : copyOf(original);
      }
      for (const child of o.children) walk(child);
    };
    walk(this.target);
    this.entries = entries;
  }
}
