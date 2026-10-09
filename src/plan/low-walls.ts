/**
 * plan/low-walls.ts — les vues des murs, comme dans les Sims : debout,
 * coupés, fantômes, bas.
 *
 * Les Sims proposent trois vues : murs debout, murs coupés (« cutaway »),
 * murs bas. En vue coupée, les murs entre le point de vue et le fond de la
 * maison descendent à hauteur de genou ; le mur du fond et les murs de côté
 * restent debout et donnent le volume des pièces. Là où un mur coupé rejoint
 * un mur debout, l'angle du mur debout reste entier : une arête nette, pas de
 * biais. Owlnest ajoute une vue fantôme : les mêmes murs, translucides.
 *
 * **Quels murs.** Un mur descend s'il fait face à la caméra et qu'il cache une
 * pièce (une pièce derrière lui, vu de la caméra). Deux lissages évitent les
 * zigzags et les poteaux sur les plans réels, pleins de petits bouts de mur
 * (raccords, murs doublés, tableaux de porte) :
 *  - un segment court prend la décision des segments alignés qui le
 *    prolongent ;
 *  - un petit mur dont tous les voisins sont abaissés (ou qui n'a pas de
 *    voisin d'un côté) descend avec eux. Un petit mur relié à un mur debout
 *    reste debout : on ne perce jamais l'enveloppe qui reste.
 *
 * **Les jonctions.** Au coin, la semelle d'un mur dépasse en onglet et partage
 * l'angle avec son voisin. Ce morceau est construit à part (voir build.ts et
 * `cornerStops`) et marqué : quand le mur descend mais que son voisin reste
 * debout, il reste entier. Le mur debout garde ainsi un angle complet, et le
 * mur coupé s'arrête net contre lui.
 *
 * **Ce qui est accroché** à un mur qui descend (tableau, miroir, meuble haut)
 * disparaît avec lui, et ce qui est posé dessus aussi. Les meubles au sol
 * restent toujours.
 *
 * **Pour la tablette**, tout se passe dans le shader : chaque sommet de mur
 * porte le numéro de son mur (`owlnestWall`, avec une fraction pour les coins),
 * et une petite texture dit, mur par mur, de combien il est abaissé. Murs et
 * meubles restent regroupés (voir batching.ts).
 */

import * as THREE from 'three';
import type { PlanDoc, PlanItem } from './types';
import { wallEnds, thicknessOf, isBoundary, faces } from './graph';
import { pointInPolygon } from './geometry';
import { itemSize, itemElevation, supportOf } from './furniture';
import { catalogItem } from './catalog';

/** Les vues des murs. */
export type WallView = 'up' | 'cutaway' | 'ghost' | 'down';
export const WALL_VIEWS: WallView[] = ['up', 'cutaway', 'ghost', 'down'];

/** Hauteur d'un mur coupé, en part de la hauteur des murs : à hauteur de genou. */
export const LOW_RATIO = 0.18;
/** Nombre de murs suivis (taille de la texture). */
const MAX_WALLS = 1024;
/** Durée de la descente ou de la remontée, en secondes. */
const TRANSITION = 0.25;
/**
 * Un mur fait face à la caméra si le regard est à moins d'environ 70° de sa
 * normale (cosinus 0,35). Il cesse de lui faire face au-delà d'environ 75°
 * (0,25) : entre les deux, il garde son état, pour ne pas clignoter.
 */
const FACING_DOWN = 0.35;
const FACING_UP = 0.25;
/** Un objet au sol moins profond que ça, adossé à un mur, est un objet mural (rideaux, étagère). */
const THIN = 0.35;
/** En dessous, un mur est un « petit mur » : raccord, retour, tableau de porte. */
const SHORT = 0.6;

export const WALL_ATTR = 'owlnestWall';
const GHOST_NAME = 'owlnest_wall_ghost';
/** Au-delà, le code désigne un meuble adossé : il disparaît en entier avec son mur. */
const ITEM_BASE = 10000;
export const wallItemCode = (wall: number) => ITEM_BASE + wall + 1;

/**
 * Marque une géométrie comme appartenant au mur n° `index`.
 * `opening` : une porte ou une fenêtre de ce mur (code négatif).
 * `corner` : le morceau d'angle au départ (1) ou à l'arrivée (2) du mur.
 */
export function tagWall(geo: THREE.BufferGeometry, index: number, opening = false, corner: 0 | 1 | 2 = 0) {
  const n = geo.getAttribute('position')?.count ?? 0;
  const v = opening ? -(index + 1) : index + 1 + corner * 0.25;
  geo.setAttribute(WALL_ATTR, new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
}

/** La géométrie porte-t-elle des murs ? Seuls eux ont un voile en vue fantôme. */
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
 * n'est pas regroupé, et chaque voile coûterait un appel de dessin. Les
 * portes et fenêtres restent de toute façon entières en vue fantôme.
 */
function inLeaf(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.userData.owlnestLeaf || n.userData.owlnestPartId || n.name.startsWith('plan_leaf_')) return true;
  }
  return false;
}

/** Un mur vu de dessus, dans le repère du plan. */
interface WallInfo {
  mid: { x: number; y: number };
  normal: { x: number; y: number };
  len: number;
  /** Limite de pièce : invisible, ne descend jamais, ne compte pas comme voisin. */
  boundary: boolean;
  /** Une pièce du côté de la normale (`front`), de l'autre côté (`back`). */
  front: boolean;
  back: boolean;
  /** Murs (hors limites) qui touchent chaque bout. */
  nearA: number[];
  nearB: number[];
  /** Le mur aligné qui le prolonge à chaque bout, s'il y en a un. */
  lineA: number;
  lineB: number;
}

export class LowWalls {
  private viewName: WallView = 'up';
  /** 1 en vue fantôme : les murs ne descendent pas, ils deviennent translucides. */
  private readonly ghostMode = { value: 0 };
  private ghostMaterial: THREE.MeshBasicMaterial | null = null;
  /** Par mur : abaissement (r), angle de départ à garder (g), angle d'arrivée à garder (b). */
  readonly data = new Uint8Array(MAX_WALLS * 4);
  readonly texture = new THREE.DataTexture(this.data, MAX_WALLS, 1, THREE.RGBAFormat);
  /** Hauteur de la coupe, dans le repère du plan. */
  private readonly cut = { value: 0.45 };
  /** Altitude du plan dans la scène (son recentrage). */
  private readonly rootY = { value: 0 };
  private walls: WallInfo[] = [];
  readonly factor = new Float32Array(MAX_WALLS);
  private goal = new Float32Array(MAX_WALLS);
  /** Meubles qui disparaissent avec leur mur. */
  attached: { holder: THREE.Object3D; wall: number }[] = [];
  private depth: THREE.MeshDepthMaterial | null = null;
  private distance: THREE.MeshDistanceMaterial | null = null;

  constructor() {
    this.texture.needsUpdate = true;
  }

  get view(): WallView { return this.viewName; }
  /** Une vue où des murs peuvent descendre (tout sauf « debout »). */
  get enabled(): boolean { return this.viewName !== 'up'; }
  get ghost(): boolean { return this.viewName === 'ghost'; }

  /** Change de vue ; le voile n'est dessiné qu'en vue fantôme. */
  setView(view: WallView, root: THREE.Object3D | null) {
    this.viewName = view;
    this.ghostMode.value = view === 'ghost' ? 1 : 0;
    root?.traverse((o) => { if (o.name === GHOST_NAME) o.visible = view === 'ghost'; });
  }

  /** Le plan vient d'être (re)construit : on relit ses murs. */
  setPlan(plan: PlanDoc, root: THREE.Object3D) {
    const rooms = faces(plan);
    const inRoom = (p: { x: number; y: number }) => rooms.some((f) => pointInPolygon(p, f.poly));
    const walls = plan.walls.slice(0, MAX_WALLS);
    const dirs = walls.map((w) => {
      const [a, b] = wallEnds(plan, w);
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { a, b, L, d: { x: (b.x - a.x) / L, y: (b.y - a.y) / L } };
    });
    this.walls = walls.map((w, i) => {
      const { a, b, L, d } = dirs[i];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const normal = { x: -d.y, y: d.x };
      // Une pièce derrière, jusqu'à un mètre : derrière un mur doublé (deux murs
      // à quelques centimètres), l'espace entre les deux n'est pas une pièce.
      const half = thicknessOf(plan, w) / 2;
      const roomSide = (s: number) => [0.15, 0.45, 0.9].some((k) => inRoom({ x: mid.x + normal.x * s * (half + k), y: mid.y + normal.y * s * (half + k) }));
      const near = (node: string) => walls.flatMap((q, j) => (j !== i && !isBoundary(plan, q) && (q.a === node || q.b === node) ? [j] : []));
      const nearA = near(w.a), nearB = near(w.b);
      const aligned = (js: number[]) => js.find((j) => Math.abs(d.x * dirs[j].d.y - d.y * dirs[j].d.x) < 0.05) ?? -1;
      return {
        mid, normal, len: L, boundary: isBoundary(plan, w),
        front: roomSide(1), back: roomSide(-1),
        nearA, nearB, lineA: aligned(nearA), lineB: aligned(nearB),
      };
    });
    this.cut.value = plan.wallHeight * LOW_RATIO;
    this.rootY.value = root.position.y;
    // Un mur qui n'existe plus n'est plus abaissé.
    for (let i = this.walls.length; i < MAX_WALLS; i++) { this.factor[i] = 0; this.goal[i] = 0; }
    this.attached = [];
    this.writeTexture();
  }

  /**
   * Ce qui est accroché à un mur au-dessus de la coupe, puis ce qui est posé
   * dessus. Ils gardent leur place dans le regroupement : le numéro de leur
   * mur suffit au shader pour les cacher.
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
      holder.userData.owlnestWallItem = wall;
      this.attached.push({ holder, wall });
    }
  }

  /**
   * Le mur avec lequel ce meuble disparaît, et de quel côté, sinon `null` :
   *  - accroché au-dessus de la coupe et posé sur rien (tableau, miroir, meuble
   *    haut) : il part toujours avec son mur, sinon il flotterait ;
   *  - fin et haut, adossé au sol contre le mur (rideaux, étagère murale,
   *    radiateur) : c'est un objet mural, il part aussi. Contre un mur coupé,
   *    il est au bord de la pièce qu'on regarde, et la boucherait.
   * Un meuble profond (armoire, buffet) reste toujours, comme dans les Sims.
   */
  private wallBehind(plan: PlanDoc, it: PlanItem): number | null {
    const c = catalogItem(it.model);
    const { w, d, h } = itemSize(it);
    const base = itemElevation(plan, it);
    const hung = c?.wall !== undefined || (base > this.cut.value && !supportOf(plan, it));
    // Posé au sol (pas sur un meuble : une lampe sur une commode reste avec elle).
    const thin = d <= THIN && base < 0.1 && base + h > this.cut.value + 0.1;
    if ((!hung && !thin) || c?.ceiling || h <= 0) return null;
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
   * Prépare les matières des murs, portes et fenêtres, l'ombre des murs, et
   * le voile de la vue fantôme. À appeler après chaque construction et chaque
   * regroupement.
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
      // Un mur coupé ne doit pas projeter l'ombre du mur entier.
      m.customDepthMaterial = this.depthMaterial();
      m.customDistanceMaterial = this.distanceMaterial();
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

  /** Les murs qui doivent être abaissés, vus de cette caméra. */
  private chooseGoals(camera: THREE.Camera, target: THREE.Vector3, root: THREE.Object3D) {
    const n = this.walls.length;
    if (this.viewName === 'up') { this.goal.fill(0, 0, n); return; }
    if (this.viewName === 'down') {
      for (let i = 0; i < n; i++) this.goal[i] = this.walls[i].boundary ? 0 : 1;
      return;
    }
    const t = root.worldToLocal(target.clone());
    const c = root.worldToLocal(camera.position.clone());
    // Vu d'en haut, tout se voit déjà : aucun mur ne descend.
    if (Math.hypot(t.x - c.x, t.z - c.z) < 0.15 * Math.max(Math.abs(t.y - c.y), 1e-6)) {
      this.goal.fill(0, 0, n);
      return;
    }
    // Un mur face à la caméra qui cache une pièce descend ; le fond et les côtés restent.
    for (let i = 0; i < n; i++) {
      const w = this.walls[i];
      if (w.boundary) { this.goal[i] = 0; continue; }
      const dx = c.x - w.mid.x, dz = c.z - w.mid.y;
      const toward = (w.normal.x * dx + w.normal.y * dz) / (Math.hypot(dx, dz) || 1);
      const hides = toward > 0 ? w.back : w.front;
      const facing = Math.abs(toward);
      if (hides && facing > FACING_DOWN) this.goal[i] = 1;
      else if (!hides || facing < FACING_UP) this.goal[i] = 0;
    }
    // Lissages, sur deux tours (une chaîne de petits morceaux).
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const w = this.walls[i];
        if (w.boundary || w.len >= SHORT || this.goal[i] === 1) continue;
        // Un segment court suit les segments alignés qui le prolongent.
        const line = [w.lineA, w.lineB].filter((j) => j >= 0);
        if (line.length && line.every((j) => this.goal[j] === 1)) { this.goal[i] = 1; continue; }
        // Un petit mur entouré de murs abaissés (ou libre d'un côté) descend avec eux.
        const near = [...w.nearA, ...w.nearB];
        if (near.some((j) => this.goal[j] === 1) && near.every((j) => this.goal[j] === 1)) this.goal[i] = 1;
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
    this.chooseGoals(camera, target, root);
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

  /** Tout remonte d'un coup. */
  reset() {
    this.factor.fill(0);
    this.goal.fill(0);
    for (const a of this.attached) a.holder.visible = true;
    this.writeTexture();
  }

  private writeTexture() {
    const standing = (j: number) => this.factor[j] < 0.5;
    for (let i = 0; i < MAX_WALLS; i++) {
      const w = i < this.walls.length ? this.walls[i] : undefined;
      this.data[i * 4] = Math.round(this.factor[i] * 255);
      // L'angle reste entier quand un voisin à ce bout reste debout.
      this.data[i * 4 + 1] = w && w.nearA.some(standing) ? 255 : 0;
      this.data[i * 4 + 2] = w && w.nearB.some(standing) ? 255 : 0;
    }
    this.texture.needsUpdate = true;
  }

  /** Injecte la vue des murs dans une matière (une seule fois). */
  private patch(material: THREE.Material) {
    if (material.userData.owlnestLow) return;
    material.userData.owlnestLow = true;
    const previousKey = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${previousKey()}|owlnest-walls`;
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previous?.call(material, shader, renderer);
      this.inject(shader, 'main');
    };
    material.needsUpdate = true;
  }

  /**
   * `main` : la scène ; `depth` : le calcul des ombres ; `ghost` : le voile.
   * Nature d'un sommet (`vOwlnestKind`) : 1 mur, 2 porte ou fenêtre, 3 meuble accroché.
   */
  private inject(shader: THREE.WebGLProgramParametersWithUniforms, pass: 'main' | 'depth' | 'ghost') {
    shader.uniforms.owlnestLowTex = { value: this.texture };
    shader.uniforms.owlnestCut = this.cut;
    shader.uniforms.owlnestRootY = this.rootY;
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
float owlnestCode = vOwlnestKind > 2.5 ? ${WALL_ATTR} - ${ITEM_BASE}.0 : abs(${WALL_ATTR});
float owlnestIndex = floor(owlnestCode + 0.01) - 1.0;
// Morceau d'angle : 1 au départ du mur, 2 à l'arrivée (fraction 0,25 ou 0,5 du code).
float owlnestCorner = vOwlnestKind < 1.5 ? floor((owlnestCode - floor(owlnestCode + 0.01)) * 4.0 + 0.5) : 0.0;
if (owlnestIndex >= 0.0) {
  vec4 owlnestState = texelFetch(owlnestLowTex, ivec2(int(owlnestIndex + 0.5), 0), 0);
  float owlnestLow = owlnestState.r;
  // L'angle d'un mur coupé reste entier quand son voisin reste debout.
  if (owlnestCorner > 0.5 && owlnestCorner < 1.5 && owlnestState.g > 0.5) owlnestLow = 0.0;
  if (owlnestCorner > 1.5 && owlnestState.b > 0.5) owlnestLow = 0.0;
  vOwlnestLow = owlnestLow;
  // Mur coupé : ses sommets hauts viennent à la coupe, il reste fermé.
  if (vOwlnestKind > 0.5 && vOwlnestKind < 1.5 && owlnestGhost < 0.5) {
    transformed.y = mix(transformed.y, min(transformed.y, owlnestCut), owlnestLow);
  }
}
vOwlnestY = (modelMatrix * vec4(transformed, 1.0)).y;`);

    const wall = 'vOwlnestKind > 0.5 && vOwlnestKind < 1.5';
    const opening = 'vOwlnestKind > 1.5 && vOwlnestKind < 2.5';
    const discard = pass === 'ghost'
      // Le voile ne garde que les murs devenus fantômes (angles entiers exclus).
      ? `if (!(${wall} && vOwlnestLow > 0.5)) discard;`
      : `if (owlnestGhost < 0.5) {
  // Murs coupés : une porte ou une fenêtre d'un mur coupé l'est à la même hauteur.
  if (${opening} && vOwlnestLow > 0.5 && vOwlnestY > owlnestCut + owlnestRootY) discard;
}${pass === 'main' ? ` else {
  // Fantôme : le mur n'est pas dessiné, le voile le remplace. Ses portes et fenêtres restent.
  if (${wall} && vOwlnestLow > 0.5) discard;
}` : ''}
// Un meuble accroché disparaît avec son mur, ombre comprise.
if (vOwlnestKind > 2.5 && vOwlnestLow > 0.5) discard;`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float owlnestCut;
uniform float owlnestRootY;
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
    m.customProgramCacheKey = () => 'owlnest-walls-ghost';
    this.ghostMaterial = m;
    return m;
  }

  private depthMaterial(): THREE.MeshDepthMaterial {
    if (this.depth) return this.depth;
    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depth.onBeforeCompile = (shader) => this.inject(shader, 'depth');
    this.depth.customProgramCacheKey = () => 'owlnest-walls-depth';
    return this.depth;
  }

  private distanceMaterial(): THREE.MeshDistanceMaterial {
    if (this.distance) return this.distance;
    this.distance = new THREE.MeshDistanceMaterial();
    this.distance.onBeforeCompile = (shader) => this.inject(shader, 'depth');
    this.distance.customProgramCacheKey = () => 'owlnest-walls-distance';
    return this.distance;
  }
}
