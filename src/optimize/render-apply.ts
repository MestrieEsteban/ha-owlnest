/**
 * render-apply.ts — les optimisations de rendu (catégorie A), appliquées par la
 * carte au modèle chargé.
 *
 * Tout est réversible et à chaud : chaque valeur touchée est notée avant
 * d'être changée, `restore` la rend. Les matériaux sont modifiés en place, pas
 * remplacés : d'autres modules (teinte des pièces, émission des lampes, effets)
 * gardent l'original d'un matériau pour le rendre plus tard, et un échange
 * dans leur dos les ferait revenir au mauvais.
 *
 * A4 (ombre du soleil figée) et A6 (plafonds) se lisent directement dans la
 * carte et dans quality.ts ; A5 (cellules) est une option de batching.ts.
 */

import * as THREE from 'three';
import type { RenderingConfig } from '../types';
import { compilePatterns } from './protected';

/** Les champs qui exigent de reprendre les objets (et donc de refusionner). */
export function tweaksKey(r: RenderingConfig | undefined): string {
  if (!r) return '';
  return JSON.stringify([
    r.physical_materials === false, r.transmission === false,
    r.shadow_policy ?? 'all', r.shadow_min_size ?? 0, r.shadow_exclude ?? [],
    r.hidden_patterns ?? [], r.max_texture_size ?? 0, r.texture_anisotropy ?? 0,
  ]);
}

type Physical = THREE.MeshPhysicalMaterial;

/** Propriétés d'un `MeshPhysicalMaterial` que A1 et A2 éteignent. */
const PHYSICAL_KEYS = [
  'clearcoat', 'sheen', 'iridescence', 'anisotropy', 'dispersion', 'specularIntensity',
  'transmission', 'thickness', 'transparent', 'opacity', 'depthWrite',
] as const;
type PhysicalState = Partial<Record<(typeof PHYSICAL_KEYS)[number], number | boolean>>;

/** Nom tel que la scène le voit : celui du nœud glTF, sinon celui de three. */
const nameOf = (o: THREE.Object3D) => (o.userData.name as string | undefined) ?? o.name;

/** Un objet ou l'un de ses parents est-il désigné par la scène ? */
function inside(o: THREE.Object3D, root: THREE.Object3D, test: (o: THREE.Object3D) => boolean): boolean {
  for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) if (test(n)) return true;
  return false;
}

export interface TweakContext {
  /** Envergure du modèle : la taille minimale d'un porteur d'ombre en est une fraction. */
  span: number;
  /** Ce que la scène désigne (ancres, pièces, effets) : jamais caché. */
  isProtected(o: THREE.Object3D): boolean;
  /** Anisotropie maximale du GPU. */
  maxAnisotropy: number;
}

export class RenderTweaks {
  private materials = new Map<Physical, PhysicalState>();
  private shadows = new Map<THREE.Mesh, boolean>();
  private hidden: THREE.Object3D[] = [];
  private textures = new Map<THREE.Texture, { image: unknown; anisotropy: number }>();
  /** Les mailles privées d'ombre par A3 : la carte en tient compte quand elle repose les ombres. */
  readonly noShadow = new Set<THREE.Mesh>();
  key = '';

  constructor(private root: THREE.Object3D) {}

  /** Applique une configuration ; rend le nombre d'objets touchés. */
  apply(r: RenderingConfig | undefined, ctx: TweakContext): number {
    this.restore();
    this.key = tweaksKey(r);
    if (!r) return 0;
    let n = 0;
    const meshes: THREE.Mesh[] = [];
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData.owlnestBatch && !o.userData.owlnestHelper) meshes.push(o as THREE.Mesh);
    });

    // A1, A2 : matériaux physiques
    if (r.physical_materials === false || r.transmission === false) {
      const seen = new Set<THREE.Material>();
      for (const mesh of meshes) {
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (seen.has(m) || !(m as Physical).isMeshPhysicalMaterial) continue;
          seen.add(m);
          n += this.simplifyMaterial(m as Physical, r.physical_materials === false, r.transmission === false) ? 1 : 0;
        }
      }
    }

    // A3 : qui porte une ombre
    const policy = r.shadow_policy ?? 'all';
    if (policy === 'selective' || policy === 'none') {
      const min = (r.shadow_min_size ?? 0.04) * ctx.span;
      const exclude = compilePatterns(r.shadow_exclude ?? []);
      const sphere = new THREE.Sphere();
      for (const mesh of meshes) {
        let off = policy === 'none';
        if (!off) {
          if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
          sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);
          off = sphere.radius * 2 < min || inside(mesh, this.root, (o) => exclude.some((re) => re.test(nameOf(o))));
        }
        if (!off) continue;
        this.noShadow.add(mesh);
        if (mesh.castShadow) { this.shadows.set(mesh, true); mesh.castShadow = false; n++; }
      }
    }

    // A7 : objets cachés
    const patterns = compilePatterns(r.hidden_patterns ?? []);
    if (patterns.length) {
      this.root.traverse((o) => {
        if (!o.visible || o === this.root || o.userData.owlnestBatch) return;
        if (!patterns.some((re) => re.test(nameOf(o)))) return;
        // Une ancre, une pièce ou un effet ne disparaît pas, ni ce qu'il porte.
        if (inside(o, this.root, ctx.isProtected)) return;
        let carries = false;
        o.traverse((c) => { if (c !== o && ctx.isProtected(c)) carries = true; });
        if (carries) return;
        o.visible = false;
        this.hidden.push(o);
        n++;
      });
    }

    // A8 : textures réduites, anisotropie plafonnée
    if (r.max_texture_size || r.texture_anisotropy) {
      const seen = new Set<THREE.Texture>();
      for (const mesh of meshes) {
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          for (const v of Object.values(m)) {
            const tex = v as THREE.Texture;
            if (!tex?.isTexture || seen.has(tex)) continue;
            seen.add(tex);
            n += this.shrinkTexture(tex, r.max_texture_size ?? 0, Math.min(ctx.maxAnisotropy, r.texture_anisotropy ?? 0)) ? 1 : 0;
          }
        }
      }
    }
    return n;
  }

  private simplifyMaterial(m: Physical, physical: boolean, transmission: boolean): boolean {
    const state: PhysicalState = {};
    for (const k of PHYSICAL_KEYS) state[k] = m[k];
    let changed = false;
    if (transmission && m.transmission > 0) {
      // Le verre redessinait toute la scène dans une texture : il devient un
      // simple calque transparent, aussi clair qu'avant à peu près.
      m.opacity = Math.min(m.opacity, 1 - 0.7 * m.transmission);
      m.transmission = 0;
      m.thickness = 0;
      m.transparent = true;
      m.depthWrite = false;
      changed = true;
    }
    if (physical && m.transmission === 0) {
      // Chaque option à zéro retire son code du shader : il ne reste presque
      // que celui d'un matériau standard.
      if (m.clearcoat || m.sheen || m.iridescence || m.anisotropy || m.dispersion || m.specularIntensity !== 1) changed = true;
      m.clearcoat = 0;
      m.sheen = 0;
      m.iridescence = 0;
      m.anisotropy = 0;
      m.dispersion = 0;
      m.specularIntensity = 1;
    }
    if (!changed) return false;
    this.materials.set(m, state);
    m.needsUpdate = true;
    return true;
  }

  private shrinkTexture(tex: THREE.Texture, max: number, anisotropy: number): boolean {
    const img = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    const before = { image: tex.image as unknown, anisotropy: tex.anisotropy };
    let changed = false;
    if (anisotropy && tex.anisotropy > anisotropy) { tex.anisotropy = anisotropy; changed = true; }
    if (max && img && typeof img.width === 'number' && Math.max(img.width, img.height) > max && !(tex as THREE.CompressedTexture).isCompressedTexture) {
      const k = max / Math.max(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * k));
      canvas.height = Math.max(1, Math.round(img.height * k));
      try {
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        tex.image = canvas;
        changed = true;
      } catch { /* image illisible : on garde l'originale */ }
    }
    if (!changed) return false;
    this.textures.set(tex, before);
    tex.needsUpdate = true;
    return true;
  }

  /** Rend chaque valeur notée. */
  restore(): void {
    this.materials.forEach((state, m) => {
      Object.assign(m, state);
      m.needsUpdate = true;
    });
    this.shadows.forEach((cast, mesh) => { mesh.castShadow = cast; });
    for (const o of this.hidden) o.visible = true;
    this.textures.forEach((before, tex) => {
      tex.image = before.image;
      tex.anisotropy = before.anisotropy;
      tex.needsUpdate = true;
    });
    this.materials.clear();
    this.shadows.clear();
    this.noShadow.clear();
    this.hidden = [];
    this.textures.clear();
    this.key = '';
  }
}

// ── Mémoire GPU ────────────────────────────────────────────────────────────

/**
 * Mémoire GPU occupée par la scène, estimée : géométries (une fois chacune) et
 * textures en RVBA avec mipmaps. `renderer.info.memory` ne donne que des
 * nombres d'objets.
 */
export function estimateGpuBytes(root: THREE.Object3D): { geometry: number; textures: number } {
  const geoms = new Set<THREE.BufferGeometry>();
  const texes = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
    if (!o.visible) return;
    geoms.add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m) continue;
      for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture) texes.add(v as THREE.Texture);
    }
  });
  let geometry = 0;
  const seen = new Set<object>();
  for (const g of geoms) {
    const attrs = [...Object.values(g.attributes), ...(g.index ? [g.index] : [])];
    for (const a of attrs) {
      // Les attributs entrelacés partagent un seul tampon : compté une fois.
      const owner = (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data : a;
      if (seen.has(owner)) continue;
      seen.add(owner);
      geometry += owner.array.byteLength;
    }
  }
  let textures = 0;
  for (const t of texes) {
    const img = t.image as { width?: number; height?: number } | undefined;
    if (!img?.width || !img.height) continue;
    const bpp = (t as THREE.CompressedTexture).isCompressedTexture ? 1 : 4;
    textures += img.width * img.height * bpp * (t.generateMipmaps || (t as THREE.CompressedTexture).mipmaps?.length ? 4 / 3 : 1);
  }
  return { geometry, textures };
}
