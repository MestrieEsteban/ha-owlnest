/**
 * plan/low-walls.ts — les murs qui s'abaissent devant la caméra, comme dans
 * les Sims, pour voir dans les pièces.
 *
 * Deux essais sur l'export OBJ avaient été rejetés (« trop étrange ») : les
 * armoires étaient coupées en deux, la vaisselle flottait quand son meuble
 * disparaissait, et des murs basculaient au mauvais moment. Tout venait de ce
 * que l'OBJ ne dit pas quel meuble est contre quel mur. Le plan, lui, le sait :
 *
 *  - **seuls les murs devant ce qu'on regarde** descendent, ceux du fond
 *    restent debout et donnent le volume des pièces. « Devant » se juge par
 *    rapport au point visé : en zoomant sur une pièce, ce sont ses murs
 *    côté caméra qui descendent ;
 *  - **un meuble adossé à un mur qui descend** (armoire, rideaux, étagère
 *    murale, tableau) disparaît avec lui, et ce qui est posé dessus aussi :
 *    rien n'est coupé, rien ne flotte ;
 *  - **les murs descendent et remontent en douceur**, avec une marge qui
 *    évite qu'un mur au milieu ne clignote quand on tourne.
 *
 * Pour la tablette, les murs restent regroupés (voir batching.ts) : ils
 * descendent dans le shader, d'après une texture qui dit, mur par mur, de
 * combien il est abaissé. Chaque sommet de mur porte le numéro de son mur
 * (`owlnestWall`) ; ceux des portes et fenêtres le portent en négatif et sont
 * coupés à la hauteur du mur bas au lieu d'être écrasés.
 */

import * as THREE from 'three';
import type { PlanDoc, PlanItem } from './types';
import { wallEnds, thicknessOf, isBoundary } from './graph';
import { itemSize, itemElevation, supportOf } from './furniture';
import { catalogItem } from './catalog';

/** Hauteur d'un mur abaissé, en part de la hauteur des murs : une plinthe haute. */
export const LOW_RATIO = 0.18;
/** Nombre de murs suivis (taille de la texture). */
const MAX_WALLS = 1024;
/** Durée de la descente ou de la remontée, en secondes. */
const TRANSITION = 0.3;
/** Un meuble adossé plus haut que ça disparaît avec son mur. */
const TALL = 1.4;
/** Un mur à moins de cette distance du point visé garde son état : pas de clignotement. */
const MARGIN = 0.4;

export const WALL_ATTR = 'owlnestWall';
/** Au-delà, le code désigne un meuble adossé : il disparaît en entier avec son mur. */
const ITEM_BASE = 10000;
export const wallItemCode = (wall: number) => ITEM_BASE + wall + 1;

/** Marque une géométrie comme appartenant au mur n° `index` ; `opening` : une porte ou une fenêtre de ce mur. */
export function tagWall(geo: THREE.BufferGeometry, index: number, opening = false) {
  const n = geo.getAttribute('position')?.count ?? 0;
  const v = (index + 1) * (opening ? -1 : 1);
  geo.setAttribute(WALL_ATTR, new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
}

/** Un mur vu de dessus, en coordonnées du plan. */
interface WallInfo { mid: { x: number; y: number } }

export class LowWalls {
  enabled = false;
  private readonly data = new Uint8Array(MAX_WALLS * 4);
  readonly texture = new THREE.DataTexture(this.data, MAX_WALLS, 1, THREE.RGBAFormat);
  /** Hauteur de la coupe, dans le repère du plan, et dans celui de la scène. */
  private readonly cut = { value: 0.45 };
  private readonly cutWorld = { value: 0.45 };
  private walls: WallInfo[] = [];
  private factor = new Float32Array(MAX_WALLS);
  private goal = new Float32Array(MAX_WALLS);
  /** Meubles qui disparaissent avec leur mur. */
  private attached: { holder: THREE.Object3D; wall: number }[] = [];
  private depth: THREE.MeshDepthMaterial | null = null;
  private distance: THREE.MeshDistanceMaterial | null = null;

  constructor() {
    this.texture.needsUpdate = true;
  }

  /** Le plan vient d'être (re)construit : on relit ses murs. */
  setPlan(plan: PlanDoc, root: THREE.Object3D) {
    this.walls = plan.walls.slice(0, MAX_WALLS).map((w) => {
      const [a, b] = wallEnds(plan, w);
      return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    });
    this.cut.value = plan.wallHeight * LOW_RATIO;
    this.cutWorld.value = this.cut.value + root.position.y;
    // Un mur qui n'existe plus n'est plus abaissé.
    for (let i = this.walls.length; i < MAX_WALLS; i++) { this.factor[i] = 0; this.goal[i] = 0; }
    this.attached = [];
    this.writeTexture();
  }

  /**
   * Les meubles adossés à un mur et qui dépassent sa coupe (ou accrochés au
   * mur), puis ceux posés sur eux. Ils gardent leur place dans le regroupement :
   * le numéro de leur mur suffit au shader pour les cacher.
   */
  attachItems(plan: PlanDoc, root: THREE.Object3D) {
    this.attached = [];
    if (!this.enabled) return;
    const items = plan.items ?? [];
    const wallOf = new Map<string, number>();
    for (const it of items) {
      const w = this.wallBehind(plan, it);
      if (w !== null) wallOf.set(it.id, w);
    }
    // Ce qui est posé sur un meuble qui disparaît disparaît aussi.
    for (const it of items) {
      if (wallOf.has(it.id)) continue;
      let under = supportOf(plan, it);
      for (let k = 0; under && k < 4; k++) {
        const w = wallOf.get(under.id);
        if (w !== undefined) { wallOf.set(it.id, w); break; }
        under = supportOf(plan, under);
      }
    }
    for (const [id, wall] of wallOf) {
      const holder = root.getObjectByName(`plan_item_${id}`);
      if (!holder) continue;
      // Regroupé, il disparaît dans le shader ; seul, on le cache directement.
      holder.userData.owlnestWallItem = wall;
      this.attached.push({ holder, wall });
    }
  }

  /** Le mur contre lequel ce meuble est adossé, s'il dépasse la coupe ; sinon `null`. */
  private wallBehind(plan: PlanDoc, it: PlanItem): number | null {
    const c = catalogItem(it.model);
    const { w, d, h } = itemSize(it);
    const base = itemElevation(plan, it);
    // Ce qui bouche la vue (armoire, étagère, rideaux) ou qui est accroché
    // au-dessus de la coupe (tableau, meuble haut). Un canapé, un buffet bas
    // restent : ils se voient très bien par-dessus un mur bas.
    const tall = c?.wall !== undefined || base > this.cut.value || base + h > TALL;
    if (!tall || c?.ceiling) return null;
    const r = (it.rotation * Math.PI) / 180;
    const front = { x: -Math.sin(r), y: Math.cos(r) };
    const back = { x: it.x - front.x * d / 2, y: it.y - front.y * d / 2 };
    let best: { i: number; gap: number } | null = null;
    plan.walls.slice(0, MAX_WALLS).forEach((wall, i) => {
      if (isBoundary(plan, wall)) return;
      const [a, b] = wallEnds(plan, wall);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1e-6) return;
      const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
      const n = { x: -dir.y, y: dir.x };
      // Adossé : le dos parallèle au mur, tout contre lui, en face de lui.
      if (Math.abs(front.x * n.x + front.y * n.y) < 0.8) return;
      const t = (back.x - a.x) * dir.x + (back.y - a.y) * dir.y;
      if (t < -w / 2 || t > L + w / 2) return;
      const gap = Math.abs((back.x - a.x) * n.x + (back.y - a.y) * n.y) - thicknessOf(plan, wall) / 2;
      if (gap > 0.15) return;
      if (!best || gap < best.gap) best = { i, gap };
    });
    return best ? (best as { i: number }).i : null;
  }

  /**
   * Prépare les matières des murs, portes et fenêtres, et l'ombre des murs.
   * À appeler après chaque construction et chaque regroupement.
   */
  instrument(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry.getAttribute(WALL_ATTR)) return;
      for (const mat of [m.material].flat()) this.patch(mat);
      // Un mur abaissé ne doit pas projeter l'ombre du mur entier.
      m.customDepthMaterial = this.depthMaterial();
      m.customDistanceMaterial = this.distanceMaterial();
    });
  }

  /**
   * Suit la caméra. Rend `true` tant que quelque chose change : il faut alors
   * redessiner (et recalculer les ombres).
   */
  update(camera: THREE.Camera, target: THREE.Vector3, root: THREE.Object3D, dt: number): boolean {
    const n = this.walls.length;
    if (!n) return false;
    if (this.enabled) {
      // Le point visé et la direction du regard, vus de dessus, dans le repère du plan.
      const t = root.worldToLocal(target.clone());
      const c = root.worldToLocal(camera.position.clone());
      const vx = t.x - c.x, vz = t.z - c.z;
      const len = Math.hypot(vx, vz);
      // Vu d'en haut, tout se voit déjà : aucun mur ne descend.
      const fromAbove = len < 0.15 * Math.max(Math.abs(t.y - c.y), 1e-6);
      for (let i = 0; i < n; i++) {
        if (fromAbove) { this.goal[i] = 0; continue; }
        const m = this.walls[i].mid;
        // Distance du mur vers la caméra, depuis le point visé.
        const s = -((m.x - t.x) * vx + (m.y - t.z) * vz) / len;
        if (s > MARGIN) this.goal[i] = 1;
        else if (s < -MARGIN) this.goal[i] = 0;
      }
    } else {
      this.goal.fill(0, 0, n);
    }
    let changed = false;
    const step = dt / TRANSITION;
    for (let i = 0; i < n; i++) {
      const f = this.factor[i], g = this.goal[i];
      if (f === g) continue;
      this.factor[i] = g > f ? Math.min(g, f + step) : Math.max(g, f - step);
      changed = true;
    }
    if (!changed) return false;
    this.writeTexture();
    for (const a of this.attached) a.holder.visible = this.factor[a.wall] < 0.5;
    return true;
  }

  /** Tout remonte d'un coup (mode coupé, plan reconstruit). */
  reset() {
    this.factor.fill(0);
    this.goal.fill(0);
    for (const a of this.attached) a.holder.visible = true;
    this.writeTexture();
  }

  get busy(): boolean {
    for (let i = 0; i < this.walls.length; i++) if (this.factor[i] !== this.goal[i]) return true;
    return false;
  }

  private writeTexture() {
    for (let i = 0; i < MAX_WALLS; i++) this.data[i * 4] = Math.round(this.factor[i] * 255);
    this.texture.needsUpdate = true;
  }

  /** Injecte la descente des murs dans une matière (une seule fois). */
  private patch(material: THREE.Material) {
    if (material.userData.owlnestLow) return;
    material.userData.owlnestLow = true;
    const previousKey = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${previousKey()}|owlnest-low`;
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previous?.call(material, shader, renderer);
      this.inject(shader);
    };
    material.needsUpdate = true;
  }

  private inject(shader: THREE.WebGLProgramParametersWithUniforms) {
    shader.uniforms.owlnestLowTex = { value: this.texture };
    shader.uniforms.owlnestCut = this.cut;
    shader.uniforms.owlnestCutWorld = this.cutWorld;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float ${WALL_ATTR};
uniform sampler2D owlnestLowTex;
uniform float owlnestCut;
varying float vOwlnestLow;
varying float vOwlnestOpening;
varying float vOwlnestItem;
varying float vOwlnestY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vOwlnestLow = 0.0;
vOwlnestOpening = ${WALL_ATTR} < 0.0 ? 1.0 : 0.0;
vOwlnestItem = ${WALL_ATTR} > ${ITEM_BASE}.0 ? 1.0 : 0.0;
float owlnestIndex = (vOwlnestItem > 0.5 ? ${WALL_ATTR} - ${ITEM_BASE}.0 : abs(${WALL_ATTR})) - 1.0;
if (owlnestIndex >= 0.0) {
  vOwlnestLow = texelFetch(owlnestLowTex, ivec2(int(owlnestIndex + 0.5), 0), 0).r;
  // Un mur descend : ses sommets hauts viennent à la coupe, il reste fermé.
  if (${WALL_ATTR} > 0.0 && vOwlnestItem < 0.5) transformed.y = mix(transformed.y, min(transformed.y, owlnestCut), vOwlnestLow);
}
vOwlnestY = (modelMatrix * vec4(transformed, 1.0)).y;`);
    // Aussi dans le calcul des ombres : un montant de fenêtre coupé ne doit pas laisser la sienne.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float owlnestCutWorld;
varying float vOwlnestLow;
varying float vOwlnestOpening;
varying float vOwlnestItem;
varying float vOwlnestY;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
// Une porte ou une fenêtre d'un mur abaissé est coupée à sa hauteur.
if (vOwlnestOpening > 0.5 && vOwlnestLow > 0.5 && vOwlnestY > owlnestCutWorld) discard;
// Un meuble adossé disparaît avec son mur.
if (vOwlnestItem > 0.5 && vOwlnestLow > 0.5) discard;`);
  }

  private depthMaterial(): THREE.MeshDepthMaterial {
    if (this.depth) return this.depth;
    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depth.onBeforeCompile = (shader) => this.inject(shader);
    this.depth.customProgramCacheKey = () => 'owlnest-low-depth';
    return this.depth;
  }

  private distanceMaterial(): THREE.MeshDistanceMaterial {
    if (this.distance) return this.distance;
    this.distance = new THREE.MeshDistanceMaterial();
    this.distance.onBeforeCompile = (shader) => this.inject(shader);
    this.distance.customProgramCacheKey = () => 'owlnest-low-distance';
    return this.distance;
  }
}
