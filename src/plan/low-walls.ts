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
 * Second mode, **fantôme** : les mêmes murs, au lieu de descendre, deviennent
 * un voile translucide. On voit l'intérieur à travers, la silhouette du mur
 * reste pour se repérer, et son ombre aussi (la lumière des pièces ne change
 * pas). Le voile est une seconde passe sur la même géométrie, dessinée par
 * dessus l'image : pas de tri d'objets transparents, donc pas les
 * recouvrements aberrants qui avaient fait écarter la transparence sur les
 * exports OBJ (voir cutaway.ts).
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
const GHOST_NAME = 'owlnest_wall_ghost';
/** Au-delà, le code désigne un meuble adossé : il disparaît en entier avec son mur. */
const ITEM_BASE = 10000;
export const wallItemCode = (wall: number) => ITEM_BASE + wall + 1;

/** Marque une géométrie comme appartenant au mur n° `index` ; `opening` : une porte ou une fenêtre de ce mur. */
export function tagWall(geo: THREE.BufferGeometry, index: number, opening = false) {
  const n = geo.getAttribute('position')?.count ?? 0;
  const v = (index + 1) * (opening ? -1 : 1);
  geo.setAttribute(WALL_ATTR, new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
}

/** La géométrie porte-t-elle des murs ou des ouvertures (et pas seulement des meubles) ? */
function hasWallFaces(geo: THREE.BufferGeometry): boolean {
  const a = geo.getAttribute(WALL_ATTR);
  if (!a) return false;
  for (let i = 0; i < a.count; i++) {
    const v = a.getX(i);
    if (v !== 0 && v < ITEM_BASE) return true;
  }
  return false;
}

/**
 * Un vantail de porte ou de fenêtre : fait de plusieurs pièces animées, il
 * n'est pas regroupé. Lui donner un voile coûterait un appel de dessin par
 * pièce ; le cadre, regroupé, suffit à dessiner la silhouette de l'ouverture.
 */
function inLeaf(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.userData.owlnestLeaf || n.userData.owlnestPartId || n.name.startsWith('plan_leaf_')) return true;
  }
  return false;
}

/** Un mur vu de dessus, en coordonnées du plan. */
interface WallInfo { mid: { x: number; y: number } }

export class LowWalls {
  enabled = false;
  /** Mode fantôme : les murs deviennent translucides au lieu de descendre. */
  private readonly ghostMode = { value: 0 };
  private ghostMaterial: THREE.MeshBasicMaterial | null = null;
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
    const found: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.userData.owlnestHelper || !m.geometry.getAttribute(WALL_ATTR)) return;
      found.push(m);
    });
    for (const m of found) {
      for (const mat of [m.material].flat()) this.patch(mat);
      // Un mur abaissé ne doit pas projeter l'ombre du mur entier.
      m.customDepthMaterial = this.depthMaterial();
      m.customDistanceMaterial = this.distanceMaterial();
      // Le voile du mode fantôme : même géométrie, dessiné par-dessus. Seulement
      // pour les murs et leurs ouvertures : un regroupement de meubles n'en a
      // pas besoin, et chaque voile coûte un appel de dessin.
      if (!m.userData.owlnestGhost && hasWallFaces(m.geometry) && !inLeaf(m)) {
        m.userData.owlnestGhost = true;
        const g = new THREE.Mesh(m.geometry, this.ghostMat());
        g.name = GHOST_NAME;
        g.userData.owlnestHelper = true;
        g.castShadow = false;
        g.receiveShadow = false;
        g.renderOrder = 10;
        g.visible = this.ghost;
        m.add(g);
      }
    }
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

  get ghost(): boolean { return this.ghostMode.value > 0.5; }

  /** Passe d'un mode à l'autre ; le voile n'est dessiné qu'en mode fantôme. */
  setGhost(on: boolean, root: THREE.Object3D | null) {
    this.ghostMode.value = on ? 1 : 0;
    root?.traverse((o) => { if (o.name === GHOST_NAME) o.visible = on; });
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
      this.inject(shader, 'main');
    };
    material.needsUpdate = true;
  }

  /**
   * `main` : la scène ; `depth` : le calcul des ombres ; `ghost` : le voile.
   * Nature d'un sommet (`vOwlnestKind`) : 1 mur, 2 porte ou fenêtre, 3 meuble adossé.
   */
  private inject(shader: THREE.WebGLProgramParametersWithUniforms, pass: 'main' | 'depth' | 'ghost') {
    shader.uniforms.owlnestLowTex = { value: this.texture };
    shader.uniforms.owlnestCut = this.cut;
    shader.uniforms.owlnestCutWorld = this.cutWorld;
    shader.uniforms.owlnestGhost = this.ghostMode;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float ${WALL_ATTR};
uniform sampler2D owlnestLowTex;
uniform float owlnestCut;
uniform float owlnestGhost;
varying float vOwlnestLow;
varying float vOwlnestKind;
varying float vOwlnestY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vOwlnestLow = 0.0;
vOwlnestKind = ${WALL_ATTR} > ${ITEM_BASE}.0 ? 3.0 : ${WALL_ATTR} < 0.0 ? 2.0 : ${WALL_ATTR} > 0.0 ? 1.0 : 0.0;
float owlnestIndex = (vOwlnestKind > 2.5 ? ${WALL_ATTR} - ${ITEM_BASE}.0 : abs(${WALL_ATTR})) - 1.0;
if (owlnestIndex >= 0.0) {
  vOwlnestLow = texelFetch(owlnestLowTex, ivec2(int(owlnestIndex + 0.5), 0), 0).r;
  // Murs bas : les sommets hauts d'un mur viennent à la coupe, il reste fermé.
  if (owlnestGhost < 0.5 && vOwlnestKind > 0.5 && vOwlnestKind < 1.5) transformed.y = mix(transformed.y, min(transformed.y, owlnestCut), vOwlnestLow);
}
vOwlnestY = (modelMatrix * vec4(transformed, 1.0)).y;`);

    const discard = pass === 'ghost'
      // Le voile ne garde que les murs (et leurs portes et fenêtres) devenus fantômes.
      ? `if (!(vOwlnestKind > 0.5 && vOwlnestKind < 2.5 && vOwlnestLow > 0.5)) discard;`
      : `if (owlnestGhost < 0.5) {
  // Murs bas : une porte ou une fenêtre d'un mur abaissé est coupée à sa hauteur.
  if (vOwlnestKind > 1.5 && vOwlnestKind < 2.5 && vOwlnestLow > 0.5 && vOwlnestY > owlnestCutWorld) discard;
}${pass === 'main' ? ` else {
  // Fantôme : le mur et ses ouvertures ne sont pas dessinés, le voile les remplace.
  if (vOwlnestKind > 0.5 && vOwlnestKind < 2.5 && vOwlnestLow > 0.5) discard;
}` : ''}
// Un meuble adossé disparaît avec son mur, ombre comprise.
if (vOwlnestKind > 2.5 && vOwlnestLow > 0.5) discard;`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float owlnestCutWorld;
uniform float owlnestGhost;
varying float vOwlnestLow;
varying float vOwlnestKind;
varying float vOwlnestY;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
${discard}`);
    if (pass === 'ghost') {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.a *= smoothstep(0.5, 1.0, vOwlnestLow);`);
    }
  }

  /** Le voile : un blanc froid, à peine présent, qui n'écrit pas la profondeur. */
  private ghostMat(): THREE.MeshBasicMaterial {
    if (this.ghostMaterial) return this.ghostMaterial;
    const m = new THREE.MeshBasicMaterial({ color: 0xe6edf5, transparent: true, opacity: 0.16, depthWrite: false });
    m.onBeforeCompile = (shader) => this.inject(shader, 'ghost');
    m.customProgramCacheKey = () => 'owlnest-low-ghost';
    this.ghostMaterial = m;
    return m;
  }

  private depthMaterial(): THREE.MeshDepthMaterial {
    if (this.depth) return this.depth;
    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depth.onBeforeCompile = (shader) => this.inject(shader, 'depth');
    this.depth.customProgramCacheKey = () => 'owlnest-low-depth';
    return this.depth;
  }

  private distanceMaterial(): THREE.MeshDistanceMaterial {
    if (this.distance) return this.distance;
    this.distance = new THREE.MeshDistanceMaterial();
    this.distance.onBeforeCompile = (shader) => this.inject(shader, 'depth');
    this.distance.customProgramCacheKey = () => 'owlnest-low-distance';
    return this.distance;
  }
}
