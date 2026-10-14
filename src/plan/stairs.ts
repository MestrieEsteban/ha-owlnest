/**
 * Les escaliers : posés sur un niveau, ils montent jusqu'au suivant, qui
 * reçoit une trémie (le trou dans son sol) bordée d'un garde-corps.
 *
 * Quatre formes : droit, en L (quart tournant), en U (demi-tournant) et en
 * colimaçon. On règle la largeur, le côté où il tourne et la pente ; le
 * nombre de marches et la longueur en découlent (des marches de 20 cm au
 * plus), on n'a rien à calculer.
 *
 * Tout est décrit dans un repère propre à l'escalier : z dans le sens où l'on
 * part en montant, x vers la droite. `layout` donne les marches et la trémie
 * dans ce repère, centrés sur le milieu de l'escalier ; `toPlan` les pose sur
 * le plan.
 *
 * La trémie ne découpe aucune géométrie : les sols concernés reçoivent quatre
 * plans de coupe qui effacent ce qui se trouve au-dessus du trou. Un vrai
 * trou, sans calcul de polygones, quelle que soit la forme des pièces.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PlanDoc, PlanStair, StairShape } from './types';
import { type Pt, pointInPolygon } from './geometry';
import { SLAB } from './floors';
import { prism } from './build';

/** Profondeur de marche selon la pente choisie. */
export const TREADS = { gentle: 0.3, normal: 0.25, steep: 0.21 } as const;
export type StairSlope = keyof typeof TREADS;
/** Hauteur de marche à ne pas dépasser. */
const MAX_RISE = 0.2;
/** Largeur proposée à la pose. */
export const STAIR_WIDTH = 0.9;
/** Hauteur d'un garde-corps. */
const RAIL = 0.9;
/** L'écart entre les deux volées d'un escalier en U. */
const GAP = 0.1;
/** Le poteau d'un colimaçon. */
const POST = 0.08;

const WOOD = '#9a7652';
const RAIL_COLOR = '#3f444b';

/** La hauteur à monter depuis un niveau, quand on ne connaît pas encore le suivant. */
export function stairRise(doc: PlanDoc): number {
  return (doc.wallHeight ?? 2.5) + SLAB;
}

export function stairSteps(rise: number): number {
  return Math.max(3, Math.ceil(rise / MAX_RISE));
}

export const shapeOf = (s: PlanStair): StairShape => s.shape ?? 'straight';
const treadOf = (s: PlanStair) => TREADS[s.slope ?? 'normal'];

/** Une marche (ou un palier) : son contour dans le repère de l'escalier (x, z en `y`), et la hauteur de son dessus. */
export interface StairStep { poly: Pt[]; top: number; landing?: boolean }

/**
 * La trémie, rectangle du repère de l'escalier. `exit` est le côté (ou la
 * portion de côté) par où l'on arrive à l'étage : pas de garde-corps là.
 */
export interface StairWell {
  x0: number; x1: number; z0: number; z1: number;
  exit: { side: 'x0' | 'x1' | 'z0' | 'z1'; from: number; to: number };
}

export interface StairLayout { steps: StairStep[]; well: StairWell }

const rect = (x0: number, x1: number, z0: number, z1: number): Pt[] =>
  [{ x: x0, y: z0 }, { x: x1, y: z0 }, { x: x1, y: z1 }, { x: x0, y: z1 }];

/** Les marches et la trémie, dans le repère de l'escalier, centrées sur son milieu. */
export function layout(s: PlanStair, rise: number): StairLayout {
  const n = stairSteps(rise), h = rise / n, T = treadOf(s), W = s.width;
  const steps: StairStep[] = [];
  let well: StairWell;
  const shape = shapeOf(s);
  // Tourner à gauche : la même chose, en miroir.
  const m = s.turn === 'left' ? -1 : 1;

  if (shape === 'l' || shape === 'u') {
    // Deux volées, un palier entre les deux (il compte pour une marche).
    const n1 = Math.floor((n - 1) / 2), n2 = n - 1 - n1;
    if (shape === 'l') {
      for (let i = 0; i < n1; i++) steps.push({ poly: rect(-W / 2, W / 2, i * T, (i + 1) * T), top: (i + 1) * h });
      const z0 = n1 * T, z1 = z0 + W;
      steps.push({ poly: rect(-W / 2, W / 2, z0, z1), top: (n1 + 1) * h, landing: true });
      for (let j = 0; j < n2; j++) steps.push({ poly: rect(W / 2 + j * T, W / 2 + (j + 1) * T, z0, z1), top: (n1 + 2 + j) * h });
      well = { x0: -W / 2, x1: W / 2 + n2 * T, z0, z1, exit: { side: 'x1', from: z0, to: z1 } };
    } else {
      const a0 = -W - GAP / 2, a1 = -GAP / 2, b0 = GAP / 2, b1 = W + GAP / 2;
      for (let i = 0; i < n1; i++) steps.push({ poly: rect(a0, a1, i * T, (i + 1) * T), top: (i + 1) * h });
      const top = n1 * T;
      steps.push({ poly: rect(a0, b1, top, top + W), top: (n1 + 1) * h, landing: true });
      for (let j = 0; j < n2; j++) steps.push({ poly: rect(b0, b1, top - (j + 1) * T, top - j * T), top: (n1 + 2 + j) * h });
      const zMin = Math.min(0, top - n2 * T);
      well = { x0: a0, x1: b1, z0: zMin, z1: top + W, exit: { side: 'z0', from: b0, to: b1 } };
    }
  } else if (shape === 'spiral') {
    // Des marches en part de tarte autour d'un poteau : un peu moins d'un tour.
    const R = W, step = Math.min((30 * Math.PI) / 180, (330 * Math.PI) / 180 / n);
    const arc = (r: number, a: number): Pt => ({ x: r * Math.sin(a), y: -r * Math.cos(a) });
    for (let i = 0; i < n; i++) {
      const a0 = i * step, a1 = (i + 1) * step;
      const poly: Pt[] = [arc(POST, a0)];
      for (let k = 0; k <= 4; k++) poly.push(arc(R, a0 + ((a1 - a0) * k) / 4));
      poly.push(arc(POST, a1));
      steps.push({ poly, top: (i + 1) * h });
    }
    // On arrive à l'étage dans la direction de la dernière marche.
    const end = arc(1, n * step - step / 2);
    const side = Math.abs(end.x) > Math.abs(end.y) ? (end.x > 0 ? 'x1' : 'x0') : (end.y > 0 ? 'z1' : 'z0');
    well = { x0: -R, x1: R, z0: -R, z1: R, exit: { side, from: -R, to: R } };
  } else {
    for (let i = 0; i < n; i++) steps.push({ poly: rect(-W / 2, W / 2, i * T, (i + 1) * T), top: (i + 1) * h });
    well = { x0: -W / 2, x1: W / 2, z0: 0, z1: n * T, exit: { side: 'z1', from: -W / 2, to: W / 2 } };
  }

  // Le miroir, puis centré sur le milieu de son emprise : c'est ce point qu'on déplace.
  if (m < 0) {
    for (const st of steps) st.poly = st.poly.map((p) => ({ x: -p.x, y: p.y })).reverse();
    const e = well.exit;
    const swap = { x0: 'x1', x1: 'x0', z0: 'z0', z1: 'z1' } as const;
    const flipAlong = e.side === 'z0' || e.side === 'z1';
    well = {
      x0: -well.x1, x1: -well.x0, z0: well.z0, z1: well.z1,
      exit: { side: swap[e.side], from: flipAlong ? -e.to : e.from, to: flipAlong ? -e.from : e.to },
    };
  }
  const pts = steps.flatMap((st) => st.poly);
  const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
  const cz = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
  for (const st of steps) st.poly = st.poly.map((p) => ({ x: p.x - cx, y: p.y - cz }));
  const e = well.exit;
  const off = e.side === 'x0' || e.side === 'x1' ? cz : cx;
  return {
    steps,
    well: {
      x0: well.x0 - cx, x1: well.x1 - cx, z0: well.z0 - cz, z1: well.z1 - cz,
      exit: { side: e.side, from: e.from - off, to: e.to - off },
    },
  };
}

/** Le sens de départ et la droite, en vecteurs du plan. */
export function stairAxes(s: PlanStair): { along: Pt; right: Pt } {
  const a = (s.rotation * Math.PI) / 180;
  return { along: { x: Math.cos(a), y: Math.sin(a) }, right: { x: Math.sin(a), y: -Math.cos(a) } };
}

/** Un point du repère de l'escalier (x à droite, z = `p.y` en avant), posé sur le plan. */
export function toPlan(s: PlanStair, p: Pt): Pt {
  const { along, right } = stairAxes(s);
  return { x: s.x + right.x * p.x + along.x * p.y, y: s.y + right.y * p.x + along.y * p.y };
}

/** Un point du plan, dans le repère de l'escalier. */
export function fromPlan(s: PlanStair, p: Pt): Pt {
  const { along, right } = stairAxes(s);
  const dx = p.x - s.x, dy = p.y - s.y;
  return { x: dx * right.x + dy * right.y, y: dx * along.x + dy * along.y };
}

/** Le point est-il sur l'escalier (à `margin` près) ? */
export function inStair(s: PlanStair, rise: number, p: Pt, margin = 0): boolean {
  const q = fromPlan(s, p);
  return layout(s, rise).steps.some((st) => {
    if (pointInPolygon(q, st.poly)) return true;
    if (!margin) return false;
    const xs = st.poly.map((v) => v.x), zs = st.poly.map((v) => v.y);
    return q.x >= Math.min(...xs) - margin && q.x <= Math.max(...xs) + margin && q.y >= Math.min(...zs) - margin && q.y <= Math.max(...zs) + margin;
  });
}

/** Les quatre coins de la trémie, sur le plan. */
export function wellCorners(s: PlanStair, rise: number): Pt[] {
  const w = layout(s, rise).well;
  return rect(w.x0, w.x1, w.z0, w.z1).map((p) => toPlan(s, p));
}

/** Un pavé, dans le repère de l'escalier (x à droite, y en hauteur, z en avant). */
function block(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/**
 * Place un groupe bâti dans le repère de l'escalier à sa place sur le plan.
 * Le z local doit suivre `along` (cos a, sin a), et le x local `right`
 * (sin a, −cos a) : une rotation de π/2 − a autour de la verticale.
 */
function seat(g: THREE.Object3D, s: PlanStair) {
  g.position.set(s.x, 0, s.y);
  g.rotation.y = Math.PI / 2 - (s.rotation * Math.PI) / 180;
}

function solid(name: string, geos: THREE.BufferGeometry[], color: string, roughness = 0.8): THREE.Mesh {
  const flat = geos.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    // Les seuls attributs communs à toutes les pièces.
    for (const k of Object.keys(f.attributes)) if (k !== 'position' && k !== 'normal') f.deleteAttribute(k);
    return f;
  });
  const geo = mergeGeometries(flat, false)!;
  geos.forEach((x) => x.dispose());
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }));
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** L'escalier en 3D, dans le repère du niveau. */
export function buildStair(s: PlanStair, rise: number): THREE.Group {
  const { steps } = layout(s, rise);
  const spiral = shapeOf(s) === 'spiral';
  const g = new THREE.Group();
  g.name = `plan_stair_${s.id}`;
  // Des marches pleines ; en colimaçon, des marches fines autour du poteau.
  const geos = steps.map((st) => prism(st.poly.map((p) => toPlan(s, p)), spiral ? st.top - 0.05 : 0, st.top));
  g.add(solid(`plan_stair_${s.id}_steps`, geos, WOOD));

  const rail: THREE.BufferGeometry[] = [];
  if (spiral) {
    const post = new THREE.CylinderGeometry(POST, POST, rise + RAIL, 16);
    post.translate(0, (rise + RAIL) / 2, 0);
    rail.push(post);
  } else if (shapeOf(s) === 'straight') {
    // La main courante, à droite en montant : deux poteaux et une lisse qui suit la pente.
    const n = steps.length, h = rise / n, T = treadOf(s), L = n * T, x = s.width / 2 - 0.04;
    rail.push(
      block(x - 0.02, x + 0.02, h, h + RAIL, -L / 2 + T * 0.3, -L / 2 + T * 0.3 + 0.04),
      block(x - 0.02, x + 0.02, rise - h, rise - h + RAIL, L / 2 - T * 0.7, L / 2 - T * 0.7 + 0.04),
    );
    const run = L - T, climb = rise - 2 * h;
    const bar = new THREE.BoxGeometry(0.05, 0.04, Math.hypot(run, climb));
    bar.rotateX(-Math.atan2(climb, run));
    bar.translate(x, h + RAIL + climb / 2, 0);
    rail.push(bar);
  }
  if (rail.length) {
    const r = solid(`plan_stair_${s.id}_rail`, rail, RAIL_COLOR, 0.5);
    seat(r, s);
    g.add(r);
  }
  return g;
}

/**
 * À l'étage d'arrivée : l'épaisseur de la dalle autour du trou, et un
 * garde-corps partout sauf là où l'on arrive.
 */
export function buildStairWell(s: PlanStair, rise: number): THREE.Group {
  const w = layout(s, rise).well, t = 0.02, r = 0.02;
  const lining = [
    block(w.x0 - t, w.x0, -SLAB, 0, w.z0, w.z1),
    block(w.x1, w.x1 + t, -SLAB, 0, w.z0, w.z1),
    block(w.x0, w.x1, -SLAB, 0, w.z0 - t, w.z0),
    block(w.x0, w.x1, -SLAB, 0, w.z1, w.z1 + t),
  ];
  const g = new THREE.Group();
  g.name = `plan_stairwell_${s.id}`;
  g.add(solid(`plan_stairwell_${s.id}_edge`, lining, '#9c988f', 0.95));
  const guard: THREE.BufferGeometry[] = [];
  // Un côté : lisse et poteaux sur les morceaux qui ne sont pas l'arrivée.
  const side = (name: StairWell['exit']['side'], a: number, b: number, at: number, xSide: boolean) => {
    const spans: [number, number][] = [];
    if (w.exit.side === name) {
      if (w.exit.from - a > 0.05) spans.push([a, w.exit.from]);
      if (b - w.exit.to > 0.05) spans.push([w.exit.to, b]);
    } else spans.push([a, b]);
    for (const [u0, u1] of spans) {
      const piece = (v0: number, v1: number, y0: number, y1: number) => xSide
        ? block(at - r, at + r, y0, y1, v0, v1)
        : block(v0, v1, y0, y1, at - r, at + r);
      guard.push(piece(u0, u1, RAIL - 0.04, RAIL));
      const posts = Math.max(1, Math.ceil(u1 - u0));
      for (let i = 0; i <= posts; i++) {
        const u = u0 + ((u1 - u0) * i) / posts;
        guard.push(piece(u - r, u + r, 0, RAIL));
      }
    }
  };
  side('x0', w.z0, w.z1, w.x0, true);
  side('x1', w.z0, w.z1, w.x1, true);
  side('z0', w.x0, w.x1, w.z0, false);
  side('z1', w.x0, w.x1, w.z1, false);
  if (guard.length) g.add(solid(`plan_stairwell_${s.id}_guard`, guard, RAIL_COLOR, 0.5));
  seat(g, s);
  return g;
}

/**
 * Perce les sols au-dessus de l'escalier : chaque maille de sol qui chevauche
 * la trémie reçoit une copie de son matériau avec quatre plans de coupe, qui
 * n'effacent que ce qui est à la fois à l'intérieur des quatre. Les plans
 * sont donnés dans le repère du niveau, et recalés sur la maille à chaque
 * image (la carte déplace la maison pour la centrer).
 */
export function cutStairHoles(meshes: THREE.Mesh[], stairs: PlanStair[], rise: number) {
  if (!stairs.length) return;
  const rects = stairs.map((s) => {
    const c = wellCorners(s, rise);
    const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
    const centre = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    return { c, centre, min: { x: Math.min(...xs), y: Math.min(...ys) }, max: { x: Math.max(...xs), y: Math.max(...ys) } };
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
      const n = new THREE.Vector3(mid.x - hit.centre.x, 0, mid.y - hit.centre.y).normalize();
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
