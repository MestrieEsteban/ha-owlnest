/**
 * plan/low-walls.ts — les murs qui s'abaissent devant la caméra, comme dans
 * les Sims, pour voir dans les pièces.
 *
 * Deux essais sur l'export OBJ avaient été rejetés (« trop étrange ») : les
 * armoires étaient coupées en deux, la vaisselle flottait quand son meuble
 * disparaissait, et des murs basculaient au mauvais moment. Tout venait de ce
 * que l'OBJ ne dit pas quel meuble est contre quel mur. Le plan, lui, le sait :
 *
 *  - **comme dans les Sims, un mur qui fait face à la caméra descend s'il y
 *    a une pièce derrière lui** : la façade avant et les cloisons tournées
 *    vers nous descendent, le mur du fond (l'extérieur derrière) et les murs
 *    de côté restent debout et donnent le volume des pièces ;
 *  - **ce qui est accroché à un mur qui descend** (tableau, miroir, meuble
 *    haut, applique) disparaît avec lui, et ce qui est posé dessus aussi :
 *    rien ne flotte. Les meubles posés au sol restent toujours ;
 *  - **les murs descendent et remontent en douceur**, avec une marge qui
 *    évite qu'un mur au milieu ne clignote quand on tourne.
 *
 * Second mode, **fantôme** : les mêmes murs, au lieu de descendre, deviennent
 * un voile translucide. On voit l'intérieur à travers, la silhouette du mur
 * reste pour se repérer, et son ombre aussi (la lumière des pièces ne change
 * pas), comme ses portes et fenêtres. Le voile est une seconde passe sur la même géométrie, dessinée par
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
import { wallEnds, thicknessOf, isBoundary, faces } from './graph';
import { pointInPolygon } from './geometry';
import { itemSize, itemElevation, supportOf } from './furniture';
import { catalogItem } from './catalog';

/**
 * Là où un mur debout touche un mur abaissé, il descend en pente jusqu'à lui
 * sur cette longueur, comme dans les Sims, au lieu de s'arrêter net.
 */
export const RAMP = 1;

/** Hauteur d'un mur abaissé, en part de la hauteur des murs : une plinthe haute. */
export const LOW_RATIO = 0.18;
/** Nombre de murs suivis (taille de la texture). */
const MAX_WALLS = 1024;
/** Durée de la descente ou de la remontée, en secondes. */
const TRANSITION = 0.3;
/**
 * Un mur descend s'il fait face à la caméra : regard à moins d'environ 70° de
 * sa normale (cosinus 0,35). Il remonte au-delà d'environ 75° (0,25) : entre
 * les deux, il garde son état, pour ne pas clignoter en tournant. Seules les
 * cloisons à peu près parallèles au regard restent debout ; un mur extérieur
 * de côté, lui, reste parce qu'il n'a que l'extérieur derrière lui.
 */
const FACING_DOWN = 0.35;
const FACING_UP = 0.25;

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

/** La géométrie porte-t-elle des murs ? Seuls eux ont un voile : les ouvertures restent entières. */
function hasWallFaces(geo: THREE.BufferGeometry): boolean {
  const a = geo.getAttribute(WALL_ATTR);
  if (!a) return false;
  for (let i = 0; i < a.count; i++) {
    const v = a.getX(i);
    if (v > 0 && v < ITEM_BASE) return true;
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

/**
 * Un mur vu de dessus, en coordonnées du plan : son milieu, sa normale, et
 * s'il y a une pièce de chaque côté (`front` du côté de la normale).
 */
interface WallInfo {
  mid: { x: number; y: number };
  normal: { x: number; y: number };
  front: boolean;
  back: boolean;
  boundary: boolean;
  /** Murs qui touchent chaque bout : un mur debout y descend en pente s'ils sont abaissés. */
  nearA: number[];
  nearB: number[];
  len: number;
}

export class LowWalls {
  enabled = false;
  /** Mode fantôme : les murs deviennent translucides au lieu de descendre. */
  private readonly ghostMode = { value: 0 };
  private ghostMaterial: THREE.MeshBasicMaterial | null = null;
  /** Par mur : abaissement (r), pente au bout de départ (g), au bout d'arrivée (b). */
  private readonly data = new Uint8Array(MAX_WALLS * 4);
  readonly texture = new THREE.DataTexture(this.data, MAX_WALLS, 1, THREE.RGBAFormat);
  /** Par mur : ses deux bouts dans le repère du plan (ax, ay, bx, by), pour la pente. */
  private readonly endsData = new Float32Array(MAX_WALLS * 4);
  private readonly ends = new THREE.DataTexture(this.endsData, MAX_WALLS, 1, THREE.RGBAFormat, THREE.FloatType);
  private readonly top = { value: 2.5 };
  /** Décalage du plan dans la scène (son recentrage). */
  private readonly root = { value: new THREE.Vector3() };
  /** Hauteur de la coupe, dans le repère du plan. */
  private readonly cut = { value: 0.45 };
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
    const rooms = faces(plan);
    const inRoom = (p: { x: number; y: number }) => rooms.some((f) => pointInPolygon(p, f.poly));
    const walls = plan.walls.slice(0, MAX_WALLS);
    this.walls = walls.map((w, i) => {
      const [a, b] = wallEnds(plan, w);
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const normal = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
      // Une pièce derrière le mur, jusqu'à un mètre : au-delà d'un mur doublé
      // (deux murs à quelques centimètres), l'espace entre les deux n'en est pas une.
      const half = thicknessOf(plan, w) / 2;
      const roomSide = (s: number) => [0.15, 0.45, 0.9].some((d) => inRoom({ x: mid.x + normal.x * s * (half + d), y: mid.y + normal.y * s * (half + d) }));
      const near = (node: string) => walls.flatMap((q, j) => (j !== i && !isBoundary(plan, q) && (q.a === node || q.b === node) ? [j] : []));
      this.endsData.set([a.x, a.y, b.x, b.y], i * 4);
      return { mid, normal, boundary: isBoundary(plan, w), front: roomSide(1), back: roomSide(-1), nearA: near(w.a), nearB: near(w.b), len: L };
    });
    this.ends.needsUpdate = true;
    this.top.value = plan.wallHeight;
    this.cut.value = plan.wallHeight * LOW_RATIO;
    this.root.value.copy(root.position);
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
    // Seul ce qui est accroché au-dessus de la coupe (tableau, miroir, meuble
    // haut, applique) disparaît : sinon il flotterait. Un meuble posé au sol
    // reste toujours, comme dans les Sims, même grand : le cacher faisait
    // disparaître l'armoire adossée à l'autre face d'un mur intérieur, dans la
    // pièce même qu'on regarde.
    // Au-dessus de la coupe et posé sur rien : accroché. Une lampe sur une commode ne l'est pas.
    const hung = c?.wall !== undefined || (base > this.cut.value && !supportOf(plan, it));
    if (!hung || c?.ceiling || h <= 0) return null;
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
      const len = Math.hypot(t.x - c.x, t.z - c.z);
      // Vu d'en haut, tout se voit déjà : aucun mur ne descend.
      const fromAbove = len < 0.15 * Math.max(Math.abs(t.y - c.y), 1e-6);
      for (let i = 0; i < n; i++) {
        const w = this.walls[i];
        if (fromAbove || w.boundary) { this.goal[i] = 0; continue; }
        // Comme dans les Sims : un mur qui fait face à la caméra descend s'il y
        // a une pièce derrière lui. Le mur du fond (l'extérieur derrière) et
        // les murs de côté (parallèles au regard) restent debout.
        const dx = c.x - w.mid.x, dz = c.z - w.mid.y;
        const d = Math.hypot(dx, dz) || 1;
        const toward = (w.normal.x * dx + w.normal.y * dz) / d;
        const hidden = toward > 0 ? w.back : w.front;
        const facing = Math.abs(toward);
        if (hidden && facing > FACING_DOWN) this.goal[i] = 1;
        else if (!hidden || facing < FACING_UP) this.goal[i] = 0;
      }
      // Un mur court pris entre deux murs abaissés ferait une pointe (deux
      // pentes qui se rejoignent) : il descend avec eux.
      if (!fromAbove) {
        for (let i = 0; i < n; i++) {
          const w = this.walls[i];
          if (this.goal[i] || w.boundary || w.len > 2 * RAMP + 0.5) continue;
          const low = (near: number[]) => near.some((j) => this.goal[j] === 1);
          if (low(w.nearA) && low(w.nearB)) this.goal[i] = 1;
        }
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
    // La pente d'un mur debout, à chaque bout qui touche un mur abaissé.
    this.walls.forEach((w, i) => {
      const standing = 1 - this.factor[i];
      const ramp = (near: number[]) => standing * near.reduce((m, j) => Math.max(m, this.factor[j]), 0);
      this.data[i * 4 + 1] = Math.round(ramp(w.nearA) * 255);
      this.data[i * 4 + 2] = Math.round(ramp(w.nearB) * 255);
    });
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
    shader.uniforms.owlnestGhost = this.ghostMode;
    shader.uniforms.owlnestEnds = { value: this.ends };
    shader.uniforms.owlnestTop = this.top;
    shader.uniforms.owlnestRoot = this.root;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float ${WALL_ATTR};
uniform sampler2D owlnestLowTex;
uniform sampler2D owlnestEnds;
uniform float owlnestTop;
uniform float owlnestCut;
uniform float owlnestGhost;
uniform vec3 owlnestRoot;
varying float vOwlnestLow;
varying float vOwlnestKind;
varying float vOwlnestCap;
varying float vOwlnestY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vOwlnestLow = 0.0;
vOwlnestCap = 1e5;
vOwlnestKind = ${WALL_ATTR} > ${ITEM_BASE}.0 ? 3.0 : ${WALL_ATTR} < 0.0 ? 2.0 : ${WALL_ATTR} > 0.0 ? 1.0 : 0.0;
float owlnestIndex = (vOwlnestKind > 2.5 ? ${WALL_ATTR} - ${ITEM_BASE}.0 : abs(${WALL_ATTR})) - 1.0;
if (owlnestIndex >= 0.0) {
  vec4 owlnestState = texelFetch(owlnestLowTex, ivec2(int(owlnestIndex + 0.5), 0), 0);
  vOwlnestLow = owlnestState.r;
  if (owlnestGhost < 0.5 && vOwlnestKind > 0.5 && vOwlnestKind < 2.5) {
    // Position dans le repère du plan, et le long du mur.
    vec3 owlnestPlan = (modelMatrix * vec4(transformed, 1.0)).xyz - owlnestRoot;
    vec4 e = texelFetch(owlnestEnds, ivec2(int(owlnestIndex + 0.5), 0), 0);
    vec2 ab = e.zw - e.xy;
    float len = max(length(ab), 1e-4);
    float t = dot(owlnestPlan.xz - e.xy, ab / len);
    // Un mur debout qui touche un mur abaissé y descend en pente, sur ${RAMP.toFixed(1)} m.
    float rise = owlnestTop - owlnestCut;
    float capA = owlnestCut + clamp(t / ${RAMP.toFixed(1)}, 0.0, 1.0) * rise;
    float capB = owlnestCut + clamp((len - t) / ${RAMP.toFixed(1)}, 0.0, 1.0) * rise;
    if (vOwlnestKind < 1.5) {
      // Mur : ses sommets hauts viennent à la coupe ou suivent la pente ; il reste fermé.
      float y = mix(transformed.y, min(transformed.y, owlnestCut), vOwlnestLow);
      y = min(y, mix(y, capA, owlnestState.g));
      y = min(y, mix(y, capB, owlnestState.b));
      transformed.y = y;
    } else {
      // Porte ou fenêtre : coupée là où son mur s'arrête (le fragment s'en charge).
      float cap = 1e5;
      if (vOwlnestLow > 0.5) cap = owlnestCut;
      if (owlnestState.g > 0.5) cap = min(cap, capA);
      if (owlnestState.b > 0.5) cap = min(cap, capB);
      vOwlnestCap = cap + owlnestRoot.y;
    }
  }
}
vOwlnestY = (modelMatrix * vec4(transformed, 1.0)).y;`);

    const discard = pass === 'ghost'
      // Le voile ne garde que les murs (et leurs portes et fenêtres) devenus fantômes.
      ? `if (!(vOwlnestKind > 0.5 && vOwlnestKind < 1.5 && vOwlnestLow > 0.5)) discard;`
      : `if (owlnestGhost < 0.5) {
  // Murs bas : une porte ou une fenêtre est coupée là où son mur s'arrête (coupe ou pente).
  if (vOwlnestKind > 1.5 && vOwlnestKind < 2.5 && vOwlnestY > vOwlnestCap) discard;
}${pass === 'main' ? ` else {
  // Fantôme : le mur n'est pas dessiné, le voile le remplace. Ses portes et
  // fenêtres restent entières : sans elles, on perdait les battants.
  if (vOwlnestKind > 0.5 && vOwlnestKind < 1.5 && vOwlnestLow > 0.5) discard;
}` : ''}
// Un meuble adossé disparaît avec son mur, ombre comprise.
if (vOwlnestKind > 2.5 && vOwlnestLow > 0.5) discard;`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float owlnestGhost;
varying float vOwlnestLow;
varying float vOwlnestKind;
varying float vOwlnestCap;
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
