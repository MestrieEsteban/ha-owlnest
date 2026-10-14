/**
 * Les escaliers : posés sur un niveau, ils montent jusqu'au suivant, qui
 * reçoit une trémie (le trou dans son sol) bordée d'un garde-corps.
 *
 * Un escalier droit, de largeur réglable ; sa longueur découle de la hauteur à
 * monter (des marches de 20 cm au plus, de 25 cm de profondeur), on n'a donc
 * rien à calculer. Le sens de montée se lit dans `rotation` : à 0°, il monte
 * vers les x croissants du plan.
 *
 * La trémie ne découpe aucune géométrie : les sols concernés reçoivent quatre
 * plans de coupe qui effacent ce qui se trouve au-dessus de l'escalier. Un
 * vrai trou, sans calcul de polygones, quelle que soit la forme des pièces.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PlanDoc, PlanStair } from './types';
import type { Pt } from './geometry';
import { SLAB } from './floors';

/** Profondeur d'une marche. */
export const TREAD = 0.25;
/** Hauteur de marche à ne pas dépasser. */
const MAX_RISE = 0.2;
/** Largeur proposée à la pose. */
export const STAIR_WIDTH = 0.9;
/** Hauteur d'un garde-corps. */
const RAIL = 0.9;

const WOOD = '#9a7652';
const RAIL_COLOR = '#3f444b';

/** La hauteur à monter depuis un niveau, quand on ne connaît pas encore le suivant. */
export function stairRise(doc: PlanDoc): number {
  return (doc.wallHeight ?? 2.5) + SLAB;
}

export function stairSteps(rise: number): number {
  return Math.max(2, Math.ceil(rise / MAX_RISE));
}

export function stairLength(rise: number): number {
  return stairSteps(rise) * TREAD;
}

/** Le sens de montée et la largeur, en vecteurs du plan. */
export function stairAxes(s: PlanStair): { along: Pt; across: Pt } {
  const a = (s.rotation * Math.PI) / 180;
  return { along: { x: Math.cos(a), y: Math.sin(a) }, across: { x: -Math.sin(a), y: Math.cos(a) } };
}

/** Les quatre coins de l'escalier vu de dessus : pied gauche, pied droit, haut droit, haut gauche. */
export function stairCorners(s: PlanStair, rise: number): Pt[] {
  const { along, across } = stairAxes(s);
  const L = stairLength(rise) / 2, W = s.width / 2;
  const at = (u: number, v: number) => ({ x: s.x + along.x * u + across.x * v, y: s.y + along.y * u + across.y * v });
  return [at(-L, -W), at(-L, W), at(L, W), at(L, -W)];
}

/** Le point est-il sur l'escalier (à `margin` près) ? */
export function inStair(s: PlanStair, rise: number, p: Pt, margin = 0): boolean {
  const { along, across } = stairAxes(s);
  const dx = p.x - s.x, dy = p.y - s.y;
  const u = dx * along.x + dy * along.y, v = dx * across.x + dy * across.y;
  return Math.abs(u) <= stairLength(rise) / 2 + margin && Math.abs(v) <= s.width / 2 + margin;
}

/** Un pavé, dans le repère de l'escalier (x en largeur, y en hauteur, z dans le sens de montée). */
function block(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Place un groupe bâti dans le repère de l'escalier à sa place sur le plan. */
function seat(g: THREE.Object3D, s: PlanStair) {
  g.position.set(s.x, 0, s.y);
  // Le z local (sens de montée) doit suivre `along` : (cos a, sin a) dans le plan.
  g.rotation.y = Math.PI / 2 - (s.rotation * Math.PI) / 180;
}

function solid(name: string, geos: THREE.BufferGeometry[], color: string, roughness = 0.8): THREE.Mesh {
  const geo = mergeGeometries(geos, false)!;
  geos.forEach((x) => x.dispose());
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }));
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** L'escalier en 3D : des marches pleines et une main courante, dans le repère du niveau. */
export function buildStair(s: PlanStair, rise: number): THREE.Group {
  const n = stairSteps(rise), h = rise / n, L = stairLength(rise), W = s.width / 2;
  const steps: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    steps.push(block(-W, W, 0, (i + 1) * h, -L / 2 + i * TREAD, -L / 2 + (i + 1) * TREAD));
  }
  const g = new THREE.Group();
  g.name = `plan_stair_${s.id}`;
  g.add(solid(`plan_stair_${s.id}_steps`, steps, WOOD));

  // La main courante, côté droit en montant : deux poteaux et une lisse qui suit la pente.
  const x = W - 0.04;
  const rail: THREE.BufferGeometry[] = [
    block(x - 0.02, x + 0.02, h, h + RAIL, -L / 2 + TREAD * 0.3, -L / 2 + TREAD * 0.3 + 0.04),
    block(x - 0.02, x + 0.02, rise - h, rise - h + RAIL, L / 2 - TREAD * 0.7, L / 2 - TREAD * 0.7 + 0.04),
  ];
  const run = L - TREAD;
  const slope = Math.atan2(rise - 2 * h, run);
  const bar = new THREE.BoxGeometry(0.05, 0.04, Math.hypot(run, rise - 2 * h));
  bar.rotateX(-slope);
  bar.translate(x, h + RAIL + (rise - 2 * h) / 2, 0);
  rail.push(bar);
  g.add(solid(`plan_stair_${s.id}_rail`, rail, RAIL_COLOR, 0.5));
  seat(g, s);
  return g;
}

/**
 * À l'étage d'arrivée : l'épaisseur de la dalle autour du trou, et un
 * garde-corps sur les trois côtés où l'on ne monte pas.
 */
export function buildStairWell(s: PlanStair, rise: number): THREE.Group {
  const L = stairLength(rise), W = s.width / 2, t = 0.02;
  const lining = [
    block(-W - t, -W, -SLAB, 0, -L / 2, L / 2),
    block(W, W + t, -SLAB, 0, -L / 2, L / 2),
    block(-W, W, -SLAB, 0, -L / 2 - t, -L / 2),
    block(-W, W, -SLAB, 0, L / 2, L / 2 + t),
  ];
  const g = new THREE.Group();
  g.name = `plan_stairwell_${s.id}`;
  g.add(solid(`plan_stairwell_${s.id}_edge`, lining, '#9c988f', 0.95));
  const r = 0.02;
  const guard: THREE.BufferGeometry[] = [
    // Les lisses, sur les deux longs côtés et au pied (au-dessus du départ).
    block(-W - r, -W + r, RAIL - 0.04, RAIL, -L / 2, L / 2),
    block(W - r, W + r, RAIL - 0.04, RAIL, -L / 2, L / 2),
    block(-W, W, RAIL - 0.04, RAIL, -L / 2 - r, -L / 2 + r),
  ];
  // Des poteaux aux coins et tous les mètres environ.
  const posts = Math.max(2, Math.ceil(L));
  for (let i = 0; i <= posts; i++) {
    const z = -L / 2 + (L * i) / posts;
    guard.push(block(-W - r, -W + r, 0, RAIL, z - r, z + r), block(W - r, W + r, 0, RAIL, z - r, z + r));
  }
  g.add(solid(`plan_stairwell_${s.id}_guard`, guard, RAIL_COLOR, 0.5));
  seat(g, s);
  return g;
}

/**
 * Perce les sols au-dessus de l'escalier : chaque maille de sol qui chevauche
 * sa trace reçoit une copie de son matériau avec quatre plans de coupe, qui
 * n'effacent que ce qui est à la fois à l'intérieur des quatre. Les plans
 * sont donnés dans le repère du niveau, et recalés sur la maille à chaque
 * image (la carte déplace la maison pour la centrer).
 */
export function cutStairHoles(meshes: THREE.Mesh[], stairs: PlanStair[], rise: number) {
  if (!stairs.length) return;
  const rects = stairs.map((s) => {
    const c = stairCorners(s, rise);
    const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
    return { s, c, min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) } };
  });
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!;
    const hit = rects.find((r) => r.min.x < b.max.x && r.max.x > b.min.x && r.min.y < b.max.z && r.max.y > b.min.z);
    if (!hit) continue;
    // Quatre plans verticaux dont les normales sortent du rectangle : un point
    // n'est effacé que s'il est du côté négatif des quatre, donc dedans.
    const local: THREE.Plane[] = [];
    for (let i = 0; i < 4; i++) {
      const p = hit.c[i], q = hit.c[(i + 1) % 4];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const centre = { x: hit.s.x, y: hit.s.y };
      const n = new THREE.Vector3(mid.x - centre.x, 0, mid.y - centre.y).normalize();
      local.push(new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(mid.x, 0, mid.y)));
    }
    const mat = (m.material as THREE.Material).clone();
    const world = local.map((p) => p.clone());
    mat.clippingPlanes = world;
    mat.clipIntersection = true;
    m.material = mat;
    // Hors des regroupements d'objets immobiles : le matériau coupé lui est propre.
    m.userData.owlnestLive = true;
    m.onBeforeRender = () => {
      for (let i = 0; i < 4; i++) world[i].copy(local[i]).applyMatrix4(m.matrixWorld);
    };
  }
}
