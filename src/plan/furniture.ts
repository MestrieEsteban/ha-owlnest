/**
 * plan/furniture.ts — les meubles posés sur le plan, en 3D et vus de dessus.
 *
 * Un modèle n'est téléchargé qu'une fois, puis cloné pour chaque meuble posé.
 * Il est ramené à un repère commun : à la taille réelle, centré sur son
 * emprise au sol, posé à hauteur zéro, la face avant tournée vers +z (le bas
 * de l'écran sur le plan, avant toute rotation).
 *
 * Les couleurs se changent par matière : les modèles du kit nomment les
 * leurs (`wood`, `carpet` pour le tissu, `metal`…), on remplace la teinte de
 * celles qu'on propose de régler.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PlanDoc, PlanItem } from './types';
import { catalogItem, modelUrl, KIT_SCALE } from './catalog';

/** Les matières qu'on laisse recolorer, et leur nom à l'écran. */
export const TINTABLE = ['carpet', 'carpetBlue', 'wood'] as const;
export type Tintable = typeof TINTABLE[number];

interface Loaded {
  scene: THREE.Group;
  /** Emprise (x, z) et hauteur (y), en mètres. */
  size: THREE.Vector3;
  /** Matières recolorables présentes dans ce modèle. */
  tints: Tintable[];
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<Loaded>>();
const ready = new Map<string, Loaded>();

const urlOf = (model: string) => (catalogItem(model) ? modelUrl(model) : model);

/** Charge (une fois) un modèle du catalogue ou une adresse de modèle importé. */
export function loadFurniture(model: string): Promise<Loaded> {
  let p = cache.get(model);
  if (!p) {
    p = loader.loadAsync(urlOf(model)).then((gltf) => {
      const scene = gltf.scene;
      if (catalogItem(model)) scene.scale.setScalar(KIT_SCALE);
      else {
        // Un meuble importé peut être en centimètres (Sweet Home 3D) ou en
        // millimètres : un canapé de 200 unités n'est pas un canapé de 200 m.
        scene.updateMatrixWorld(true);
        const s = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
        const big = Math.max(s.x, s.y, s.z);
        if (big > 2000) scene.scale.multiplyScalar(0.001);
        else if (big > 20) scene.scale.multiplyScalar(0.01);
      }
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const c = box.getCenter(new THREE.Vector3());
      // Centré sur son emprise, posé au sol.
      scene.position.set(-c.x, -box.min.y, -c.z);
      const wrap = new THREE.Group();
      wrap.add(scene);
      const tints = new Set<Tintable>();
      wrap.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of [m.material].flat()) if ((TINTABLE as readonly string[]).includes(mat.name)) tints.add(mat.name as Tintable);
      });
      const out = { scene: wrap, size: box.getSize(new THREE.Vector3()), tints: [...tints] };
      ready.set(model, out);
      return out;
    });
    // Un échec ne doit pas rester en cache : on réessaiera au prochain essai.
    p.catch(() => cache.delete(model));
    cache.set(model, p);
  }
  return p;
}

/** Taille connue d'un modèle déjà chargé (sinon rien). */
export function furnitureSize(model: string): THREE.Vector3 | null {
  return ready.get(model)?.size ?? null;
}

export function furnitureTints(model: string): Tintable[] {
  return ready.get(model)?.tints ?? [];
}

/** Taille d'origine d'un modèle, en mètres : largeur, profondeur, hauteur. */
export function baseSize(model: string): { w: number; d: number; h: number } | null {
  const s = furnitureSize(model);
  return s ? { w: s.x, d: s.z, h: s.y } : null;
}

/** Emprise d'un meuble posé, en mètres : largeur (x local), profondeur, hauteur. */
export function itemSize(item: PlanItem): { w: number; d: number; h: number } {
  if (item.size) return { w: item.size[0], d: item.size[1], h: item.size[2] };
  const s = baseSize(item.model);
  const k = item.scale ?? 1;
  return s ? { w: s.w * k, d: s.d * k, h: s.h * k } : { w: 0.5, d: 0.5, h: 0.5 };
}

/** Le point est-il sur l'emprise de ce meuble (rectangle tourné) ? */
export function overItem(item: PlanItem, p: { x: number; y: number }, margin = 0): boolean {
  const { w, d } = itemSize(item);
  const a = (item.rotation * Math.PI) / 180;
  const vx = p.x - item.x, vy = p.y - item.y;
  const lx = vx * Math.cos(a) + vy * Math.sin(a), ly = -vx * Math.sin(a) + vy * Math.cos(a);
  return Math.abs(lx) <= w / 2 + margin && Math.abs(ly) <= d / 2 + margin;
}

/** Le meuble sur lequel un objet est posé, s'il y en a un. */
export function supportOf(plan: PlanDoc, item: PlanItem): PlanItem | null {
  if (!catalogItem(item.model)?.top) return null;
  let best: PlanItem | null = null;
  for (const other of plan.items ?? []) {
    if (other.id === item.id || !catalogItem(other.model)?.surface || !overItem(other, item)) continue;
    if (!best || itemTop(plan, other) > itemTop(plan, best)) best = other;
  }
  return best;
}

/** Hauteur du dessus d'un meuble. */
export function itemTop(plan: PlanDoc, item: PlanItem, depth = 0): number {
  return itemElevation(plan, item, depth) + itemSize(item).h;
}

/**
 * Hauteur du bas d'un meuble : celle choisie, sinon au mur ou sous le
 * plafond selon le catalogue, sur le meuble du dessous pour un objet posé
 * (une lampe sur une table de chevet), et au sol pour le reste.
 */
export function itemElevation(plan: PlanDoc, item: PlanItem, depth = 0): number {
  if (item.elevation !== undefined) return item.elevation;
  const c = catalogItem(item.model);
  if (c?.ceiling) return Math.max(0, plan.wallHeight - itemSize(item).h);
  if (c?.wall !== undefined) return c.wall;
  // Garde-fou : des objets empilés en boucle ne doivent pas tourner sans fin.
  const under = depth < 4 ? supportOf(plan, item) : null;
  return under ? itemTop(plan, under, depth + 1) : 0;
}

/** Une copie du modèle pour un meuble posé, aux couleurs choisies. */
function instance(loaded: Loaded, item: PlanItem): THREE.Object3D {
  const obj = loaded.scene.clone(true);
  const colors = item.colors ?? {};
  if (Object.keys(colors).length) {
    const swapped = new Map<THREE.Material, THREE.Material>();
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const swap = (mat: THREE.Material) => {
        const color = colors[mat.name];
        if (!color) return mat;
        let copy = swapped.get(mat);
        if (!copy) {
          copy = mat.clone();
          (copy as THREE.MeshStandardMaterial).color?.set(color);
          swapped.set(mat, copy);
        }
        return copy;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
  }
  return obj;
}

/** Préfixe des meubles dans la scène : `plan_item_<id>`. */
export const ITEM_PREFIX = 'plan_item_';

/**
 * Pose les meubles du plan dans `root` (le groupe de la maison). Ceux dont le
 * modèle n'est pas encore là arrivent dès qu'il est chargé ; `onReady` est
 * appelé une fois tout posé, pour un nouveau rendu.
 */
export async function placeFurniture(plan: PlanDoc, root: THREE.Object3D, onReady?: () => void): Promise<void> {
  const items = plan.items ?? [];
  const group = new THREE.Group();
  group.name = 'plan_items';
  root.add(group);
  await Promise.all(items.map(async (item) => {
    let loaded: Loaded;
    try {
      loaded = await loadFurniture(item.model);
    } catch (err) {
      console.warn('[Owlnest] furniture not found:', item.model, err);
      return;
    }
    // Le plan a pu être reconstruit entre-temps.
    if (!group.parent) return;
    const obj = instance(loaded, item);
    const holder = new THREE.Group();
    holder.name = `${ITEM_PREFIX}${item.id}`;
    holder.position.set(item.x, itemElevation(plan, item), item.y);
    holder.rotation.y = -THREE.MathUtils.degToRad(item.rotation);
    // Taille voulue, axe par axe : on étire le modèle d'origine.
    const want = itemSize(item);
    holder.scale.set(want.w / loaded.size.x, want.h / loaded.size.y, want.d / loaded.size.z);
    holder.userData.owlnestItem = item.id;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = [m.material].flat();
      m.castShadow = !mats.some((x) => x.transparent || x.name === 'glass');
      m.receiveShadow = true;
    });
    holder.add(obj);
    group.add(holder);
  }));
  onReady?.();
}

/** Où se trouve l'ampoule d'une lampe posée, dans le repère du plan (x, hauteur, y). */
export function bulbPosition(plan: PlanDoc, item: PlanItem): [number, number, number] {
  const { h } = itemSize(item);
  const c = catalogItem(item.model);
  const base = itemElevation(plan, item);
  // Le haut de l'abat-jour pour une lampe posée, le bas pour une suspension.
  const y = c?.ceiling ? base + h * 0.2 : base + h * 0.85;
  return [item.x, y, item.y];
}

// ── Vue de dessus, pour le plan 2D ─────────────────────────────────────────

let topRenderer: THREE.WebGLRenderer | null = null;
const topCache = new Map<string, string>();

/**
 * L'image d'un meuble vu d'au-dessus, à mettre sur le plan. Rendue une fois
 * par modèle et par jeu de couleurs.
 */
export async function topView(item: PlanItem): Promise<string | null> {
  const key = `${item.model}|${JSON.stringify(item.colors ?? {})}`;
  const hit = topCache.get(key);
  if (hit) return hit;
  let loaded: Loaded;
  try {
    loaded = await loadFurniture(item.model);
  } catch {
    return null;
  }
  if (typeof document === 'undefined') return null;
  if (!topRenderer) {
    try {
      topRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    } catch {
      return null;
    }
    topRenderer.setClearColor(0x000000, 0);
    topRenderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  const { x: w, z: d, y: h } = loaded.size;
  const px = 256;
  const k = px / Math.max(w, d);
  topRenderer.setSize(Math.max(8, Math.round(w * k)), Math.max(8, Math.round(d * k)), false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-1, 3, -2);
  scene.add(sun);
  scene.add(instance(loaded, item));
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0.01, h + 10);
  // Vue de dessus, l'avant du meuble en bas de l'image.
  cam.position.set(0, h + 5, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  topRenderer.render(scene, cam);
  const url = topRenderer.domElement.toDataURL('image/png');
  topCache.set(key, url);
  return url;
}
