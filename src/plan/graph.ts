/**
 * plan/graph.ts — le réseau de murs : ajouter, couper, déplacer, et trouver
 * les pièces.
 *
 * Toutes les opérations travaillent sur un brouillon (le plan est muté), et
 * gardent le réseau propre :
 *
 *  - un nouveau mur qui part d'un mur existant le coupe en deux à cet endroit
 *    (une jonction en T) ;
 *  - deux murs qui se croisent sont coupés au croisement ;
 *  - un mur tracé par-dessus un mur existant ne le double pas ;
 *  - un coin où se rejoignent deux murs alignés disparaît : le mur redevient
 *    un seul mur.
 *
 * Les pièces sont les espaces fermés du réseau (les « faces » du graphe). On
 * les retrouve en suivant les murs toujours en tournant du même côté.
 */

import type { PlanDoc, PlanNode, PlanWall, PlanOpening } from './types';
import {
  type Pt, sub, add, mul, dot, len, dist, norm, cross, area, project, segmentCross, insidePoint, pointInPolygon, round3,
} from './geometry';

/** Distance sous laquelle un point tombe sur un coin ou un mur existant. */
export const NODE_SNAP = 0.12;

let seq = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

// ── Lecture ─────────────────────────────────────────────────────────────────

export function nodeOf(plan: PlanDoc, id: string): PlanNode | undefined {
  return plan.nodes.find((n) => n.id === id);
}

export function wallEnds(plan: PlanDoc, w: PlanWall): [Pt, Pt] {
  const a = nodeOf(plan, w.a)!, b = nodeOf(plan, w.b)!;
  return [a, b];
}

export const wallLength = (plan: PlanDoc, w: PlanWall) => { const [a, b] = wallEnds(plan, w); return dist(a, b); };
export const thicknessOf = (plan: PlanDoc, w: PlanWall) => w.thickness ?? plan.wallThickness;
export const heightOf = (plan: PlanDoc, w: PlanWall) => w.height ?? plan.wallHeight;
/**
 * Une limite de pièce : un « mur » de hauteur nulle. Il ferme l'espace (la
 * pièce existe, avec son sol et son nom) sans rien construire en 3D, comme le
 * trait qui sépare une cuisine ouverte du salon sur un plan d'architecte.
 */
export const isBoundary = (plan: PlanDoc, w: PlanWall) => heightOf(plan, w) < 0.01;

/** Point du milieu d'une ouverture, sur l'axe de son mur. */
export function openingPoint(plan: PlanDoc, o: PlanOpening): Pt | null {
  const w = plan.walls.find((q) => q.id === o.wall);
  if (!w) return null;
  const [a, b] = wallEnds(plan, w);
  return add(a, mul(norm(sub(b, a)), o.offset));
}

/** Une ouverture tient-elle entière sur son mur ? */
export function openingFits(plan: PlanDoc, o: PlanOpening): boolean {
  const w = plan.walls.find((q) => q.id === o.wall);
  if (!w) return false;
  const l = wallLength(plan, w);
  return o.offset - o.width / 2 >= -1e-3 && o.offset + o.width / 2 <= l + 1e-3;
}

/** Le mur le plus proche d'un point, et la position du point le long de lui. */
export function wallAt(plan: PlanDoc, p: Pt, tol = NODE_SNAP): { wall: PlanWall; offset: number; d: number } | null {
  let best: { wall: PlanWall; offset: number; d: number } | null = null;
  for (const w of plan.walls) {
    const [a, b] = wallEnds(plan, w);
    const pr = project(p, a, b);
    const reach = Math.max(tol, thicknessOf(plan, w) / 2 + tol / 2);
    if (pr.d > reach || (best && pr.d >= best.d)) continue;
    best = { wall: w, offset: pr.t * dist(a, b), d: pr.d };
  }
  return best;
}

export function nodeAt(plan: PlanDoc, p: Pt, tol = NODE_SNAP): PlanNode | null {
  let best: PlanNode | null = null, bd = tol;
  for (const n of plan.nodes) {
    const d = dist(n, p);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

export function degree(plan: PlanDoc, nodeId: string): number {
  return plan.walls.filter((w) => w.a === nodeId || w.b === nodeId).length;
}

// ── Écriture ────────────────────────────────────────────────────────────────

function makeNode(plan: PlanDoc, p: Pt): PlanNode {
  const n = { id: newId('n'), x: round3(p.x), y: round3(p.y) };
  plan.nodes.push(n);
  return n;
}

/**
 * Coupe un mur en deux au point `p` (projeté sur lui). Le premier morceau
 * garde l'identifiant, et les ouvertures passent sur le morceau qui porte
 * leur milieu.
 */
export function splitWall(plan: PlanDoc, wallId: string, p: Pt): PlanNode {
  const w = plan.walls.find((q) => q.id === wallId)!;
  const [a, b] = wallEnds(plan, w);
  const pr = project(p, a, b);
  const n = makeNode(plan, pr.p);
  const cut = pr.t * dist(a, b);
  const second: PlanWall = { ...w, id: newId('w'), a: n.id, b: w.b };
  w.b = n.id;
  plan.walls.push(second);
  for (const o of plan.openings) {
    if (o.wall !== w.id || o.offset <= cut) continue;
    o.wall = second.id;
    o.offset = round3(o.offset - cut);
  }
  return n;
}

/** Le coin sous `p` : un coin existant, un nouveau coin sur un mur (coupé), ou un coin libre. */
export function ensureNode(plan: PlanDoc, p: Pt, tol = NODE_SNAP): PlanNode {
  const near = nodeAt(plan, p, tol);
  if (near) return near;
  const on = wallAt(plan, p, tol);
  if (on) return splitWall(plan, on.wall.id, p);
  return makeNode(plan, p);
}

const connected = (plan: PlanDoc, a: string, b: string) =>
  plan.walls.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));

/**
 * Ajoute un mur de `p` à `q`, en gardant le réseau propre (voir l'en-tête).
 * Rend les identifiants des murs créés.
 */
export function addWall(plan: PlanDoc, p: Pt, q: Pt, opts: Partial<Pick<PlanWall, 'thickness' | 'height'>> = {}): string[] {
  if (dist(p, q) < NODE_SNAP) return [];
  const na = ensureNode(plan, p);
  const nb = ensureNode(plan, q);
  if (na.id === nb.id) return [];

  // Les murs existants que le nouveau croise sont coupés au croisement.
  for (const w of [...plan.walls]) {
    const [a, b] = wallEnds(plan, w);
    const c = segmentCross(na, nb, a, b);
    if (c) splitWall(plan, w.id, c.p);
  }

  // Tous les coins posés sur le tracé, dans l'ordre : le nouveau mur passe
  // par eux, et ne double aucun mur existant.
  const dir = sub(nb, na), L = len(dir);
  const along = plan.nodes
    .map((n) => ({ n, t: dot(sub(n, na), dir) / (L * L), d: Math.abs(cross(sub(n, na), dir)) / L }))
    .filter((x) => x.t > -1e-6 && x.t < 1 + 1e-6 && x.d < 1e-3)
    .sort((x, y) => x.t - y.t);

  const made: string[] = [];
  for (let i = 0; i + 1 < along.length; i++) {
    const u = along[i].n, v = along[i + 1].n;
    if (u.id === v.id || connected(plan, u.id, v.id)) continue;
    const w: PlanWall = { id: newId('w'), a: u.id, b: v.id, ...opts };
    plan.walls.push(w);
    made.push(w.id);
  }
  return made;
}

/** Les quatre murs d'une pièce rectangulaire. */
export function addRect(plan: PlanDoc, x0: number, y0: number, x1: number, y1: number): string[] {
  const c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const made: string[] = [];
  for (let i = 0; i < 4; i++) made.push(...addWall(plan, c[i], c[(i + 1) % 4]));
  return made;
}

/** Retire un mur, ses ouvertures, et les coins qui ne servent plus. */
export function removeWall(plan: PlanDoc, wallId: string) {
  plan.walls = plan.walls.filter((w) => w.id !== wallId);
  plan.openings = plan.openings.filter((o) => o.wall !== wallId);
  cleanup(plan);
}

/**
 * Remet le réseau au propre : retire les coins orphelins et fond les murs
 * alignés qui ne se rejoignent qu'entre eux.
 */
export function cleanup(plan: PlanDoc) {
  const used = new Set(plan.walls.flatMap((w) => [w.a, w.b]));
  plan.nodes = plan.nodes.filter((n) => used.has(n.id));
  // Murs de longueur nulle (deux coins confondus après un déplacement).
  for (const w of [...plan.walls]) {
    if (wallLength(plan, w) < 1e-3) mergeNodes(plan, w.b, w.a);
  }
  let merged = true;
  while (merged) {
    merged = false;
    for (const n of plan.nodes) {
      const ws = plan.walls.filter((w) => w.a === n.id || w.b === n.id);
      if (ws.length !== 2) continue;
      const [w1, w2] = ws;
      if ((w1.thickness ?? null) !== (w2.thickness ?? null) || (w1.height ?? null) !== (w2.height ?? null)) continue;
      const o1 = w1.a === n.id ? w1.b : w1.a, o2 = w2.a === n.id ? w2.b : w2.a;
      const p1 = nodeOf(plan, o1)!, p2 = nodeOf(plan, o2)!;
      if (Math.abs(cross(norm(sub(n, p1)), norm(sub(p2, n)))) > 1e-4 || dot(sub(n, p1), sub(p2, n)) <= 0) continue;
      // w1 devient p1 → p2 ; les ouvertures de w2 y passent, décalées.
      const l1 = dist(p1, n);
      const w1Forward = w1.b === n.id;
      for (const o of plan.openings) {
        if (o.wall === w1.id && !w1Forward) o.offset = round3(l1 - o.offset);
        if (o.wall === w2.id) {
          const l2 = dist(n, p2);
          const fromN = w2.a === n.id ? o.offset : l2 - o.offset;
          o.wall = w1.id;
          o.offset = round3(l1 + fromN);
        }
      }
      w1.a = o1; w1.b = o2;
      plan.walls = plan.walls.filter((w) => w.id !== w2.id);
      plan.nodes = plan.nodes.filter((q) => q.id !== n.id);
      merged = true;
      break;
    }
  }
}

/** Fond le coin `from` dans le coin `into` : les murs qui partaient de lui partent de l'autre. */
export function mergeNodes(plan: PlanDoc, from: string, into: string) {
  if (from === into) return;
  for (const w of plan.walls) {
    if (w.a === from) w.a = into;
    if (w.b === from) w.b = into;
  }
  // Murs devenus nuls ou en double.
  const seen = new Set<string>();
  plan.walls = plan.walls.filter((w) => {
    if (w.a === w.b) { plan.openings = plan.openings.filter((o) => o.wall !== w.id); return false; }
    const key = [w.a, w.b].sort().join('|');
    if (seen.has(key)) { plan.openings = plan.openings.filter((o) => o.wall !== w.id); return false; }
    seen.add(key);
    return true;
  });
  plan.nodes = plan.nodes.filter((n) => n.id !== from);
}

/** Déplace un coin ; s'il tombe sur un autre coin, les deux fusionnent. */
export function moveNode(plan: PlanDoc, id: string, p: Pt, snapTol = 0) {
  const n = nodeOf(plan, id);
  if (!n) return;
  n.x = round3(p.x); n.y = round3(p.y);
  if (snapTol > 0) {
    const other = plan.nodes.find((q) => q.id !== id && dist(q, n) < snapTol);
    if (other) { mergeNodes(plan, id, other.id); }
  }
}

/** Déplace un mur parallèlement à lui-même : les murs voisins s'allongent ou raccourcissent. */
export function moveWall(plan: PlanDoc, wallId: string, delta: Pt) {
  const w = plan.walls.find((q) => q.id === wallId);
  if (!w) return;
  for (const id of [w.a, w.b]) {
    const n = nodeOf(plan, id)!;
    n.x = round3(n.x + delta.x); n.y = round3(n.y + delta.y);
  }
}

// ── Pièces ──────────────────────────────────────────────────────────────────

export interface Face {
  nodes: string[];
  poly: Pt[];
  area: number;
}

/**
 * Les espaces fermés du réseau.
 *
 * On part de chaque côté de chaque mur et on avance en prenant toujours, à
 * chaque coin, le mur le plus à droite : on fait ainsi le tour d'un espace.
 * Les espaces intérieurs tournent dans un sens, le contour extérieur dans
 * l'autre ; on ne garde que les premiers.
 */
export function faces(plan: PlanDoc): Face[] {
  const pos = new Map(plan.nodes.map((n) => [n.id, n]));
  // Voisins de chaque coin, triés par angle.
  const around = new Map<string, string[]>();
  for (const w of plan.walls) {
    if (!pos.has(w.a) || !pos.has(w.b)) continue;
    around.set(w.a, [...(around.get(w.a) ?? []), w.b]);
    around.set(w.b, [...(around.get(w.b) ?? []), w.a]);
  }
  const angle = (from: string, to: string) => {
    const a = pos.get(from)!, b = pos.get(to)!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  for (const [id, list] of around) list.sort((p, q) => angle(id, p) - angle(id, q));

  const used = new Set<string>();
  const out: Face[] = [];
  for (const w of plan.walls) {
    for (const [s, t] of [[w.a, w.b], [w.b, w.a]] as const) {
      if (used.has(`${s}>${t}`)) continue;
      const cycle: string[] = [];
      let u = s, v = t, guard = 0;
      while (!used.has(`${u}>${v}`) && guard++ < 10000) {
        used.add(`${u}>${v}`);
        cycle.push(u);
        const list = around.get(v)!;
        const i = list.indexOf(u);
        // Le voisin juste avant celui d'où l'on vient, dans l'ordre des angles.
        const next = list[(i - 1 + list.length) % list.length];
        u = v; v = next;
      }
      if (cycle.length < 3) continue;
      const poly = cycle.map((id) => pos.get(id)!);
      const a = area(poly);
      if (a > 1e-4) out.push({ nodes: cycle, poly, area: a });
    }
  }
  return out;
}

/**
 * Accorde les pièces au réseau : chaque espace fermé a sa pièce (une nouvelle
 * s'il n'en avait pas), et une pièce dont l'espace a disparu s'en va. Quand un
 * mur supprimé réunit deux pièces, la plus ancienne garde son nom.
 */
export function reconcileRooms(plan: PlanDoc, newName: () => string, newFloor: () => string) {
  const fs = faces(plan).sort((p, q) => p.area - q.area);
  const kept: typeof plan.rooms = [];
  const taken = new Set<string>();
  for (const f of fs) {
    const room = plan.rooms.find((r) => !taken.has(r.id) && pointInPolygon(r.seed, f.poly)
      // La graine doit tomber dans cet espace-ci, pas dans un plus petit qu'il contient.
      && !fs.some((g) => g.area < f.area && pointInPolygon(r.seed, g.poly)));
    if (room) {
      taken.add(room.id);
      // La graine reste dedans, même si la pièce a changé de forme.
      if (!pointInPolygon(room.seed, f.poly)) room.seed = insidePoint(f.poly);
      kept.push(room);
    } else {
      const seed = insidePoint(f.poly);
      kept.push({ id: newId('r'), name: newName(), floor: newFloor(), seed: { x: round3(seed.x), y: round3(seed.y) } });
    }
  }
  plan.rooms = kept;
}

/** Le contour d'une pièce : l'espace fermé qui contient sa graine. */
export function roomPolygon(plan: PlanDoc, roomId: string, all = faces(plan)): Pt[] | null {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const hits = all.filter((f) => pointInPolygon(room.seed, f.poly)).sort((p, q) => p.area - q.area);
  return hits[0]?.poly ?? null;
}

/** La pièce sous un point. */
export function roomAtPoint(plan: PlanDoc, p: Pt, all = faces(plan)): { roomId: string; poly: Pt[] } | null {
  const f = all.filter((g) => pointInPolygon(p, g.poly)).sort((a, b) => a.area - b.area)[0];
  if (!f) return null;
  const room = plan.rooms.find((r) => pointInPolygon(r.seed, f.poly)
    && !all.some((g) => g.area < f.area && pointInPolygon(r.seed, g.poly)));
  return room ? { roomId: room.id, poly: f.poly } : null;
}

/** Surface d'un polygone de pièce, en m² (sur les axes des murs). */
export const polygonArea = (poly: readonly Pt[]) => Math.abs(area(poly));

// ── Après un geste ──────────────────────────────────────────────────────────

/**
 * Après un déplacement libre (coin ou mur glissé), remet le réseau d'aplomb :
 * un coin lâché sur un mur s'y accroche, deux murs qui se croisent désormais
 * sont coupés au croisement, et les coins confondus fusionnent.
 */
export function settle(plan: PlanDoc, tol = NODE_SNAP / 2) {
  for (const n of [...plan.nodes]) {
    if (!plan.nodes.includes(n)) continue;
    const other = plan.nodes.find((q) => q.id !== n.id && dist(q, n) < tol);
    if (other) { mergeNodes(plan, n.id, other.id); continue; }
    for (const w of plan.walls) {
      if (w.a === n.id || w.b === n.id) continue;
      const [a, b] = wallEnds(plan, w);
      const pr = project(n, a, b);
      if (pr.d > tol || pr.t <= 0 || pr.t >= 1) continue;
      const m = splitWall(plan, w.id, n);
      mergeNodes(plan, m.id, n.id);
      break;
    }
  }
  for (let guard = 0; guard < 200; guard++) {
    let hit: { w1: PlanWall; w2: PlanWall; p: Pt } | null = null;
    for (let i = 0; i < plan.walls.length && !hit; i++) {
      for (let j = i + 1; j < plan.walls.length && !hit; j++) {
        const w1 = plan.walls[i], w2 = plan.walls[j];
        const [a, b] = wallEnds(plan, w1), [c, d] = wallEnds(plan, w2);
        const x = segmentCross(a, b, c, d);
        if (x) hit = { w1, w2, p: x.p };
      }
    }
    if (!hit) break;
    const m1 = splitWall(plan, hit.w1.id, hit.p);
    const m2 = splitWall(plan, hit.w2.id, hit.p);
    mergeNodes(plan, m2.id, m1.id);
  }
  cleanup(plan);
}

/**
 * Recolle les murs qui s'arrêtent juste avant un autre : un plan importé (ou
 * dessiné vite) a souvent des bouts de mur à quelques centimètres de celui
 * qu'ils devaient rejoindre. Sans ce recollage, l'espace n'est pas fermé :
 * pas de pièce, donc ni sol ni nom.
 *
 * Pour chaque bout libre, dans l'ordre : le prolonger jusqu'au mur qu'il vise ;
 * sinon, s'il est près d'un autre bout libre, les réunir à l'angle que font
 * leurs deux murs ; sinon, s'il vise un coin tout proche, l'y accrocher. Deux
 * murs parallèles (un mur doublé) ne sont jamais reliés en biais. Rend le
 * nombre de bouts recollés.
 */
export function closeGaps(plan: PlanDoc, reach = 0.3): number {
  let fixed = 0;
  const freeEnd = (id: string) => {
    if (degree(plan, id) !== 1) return null;
    const w = plan.walls.find((x) => x.a === id || x.b === id)!;
    const n = nodeOf(plan, id)!, o = nodeOf(plan, w.a === id ? w.b : w.a)!;
    return { w, n, o, dir: norm(sub(n, o)) };
  };
  for (const node of [...plan.nodes]) {
    if (!plan.nodes.includes(node)) continue;
    const end = freeEnd(node.id);
    if (!end) continue;
    const { w, n, o, dir } = end;

    // 1. Prolonger le mur jusqu'au premier mur qu'il rencontre.
    let hit: { p: Pt; t: number } | null = null;
    for (const q of plan.walls) {
      if (q === w || q.a === node.id || q.b === node.id) continue;
      const [a, b] = wallEnds(plan, q);
      const e = sub(b, a);
      const den = cross(dir, e);
      if (Math.abs(den) < 1e-9) continue;
      const t = cross(sub(a, n), e) / den;
      const u = cross(sub(a, n), dir) / den;
      if (t < 1e-4 || t > reach || u < -1e-6 || u > 1 + 1e-6) continue;
      if (!hit || t < hit.t) hit = { p: add(n, mul(dir, t)), t };
    }
    if (hit) { moveNode(plan, node.id, hit.p); fixed++; continue; }

    // 2. Un autre bout libre tout près : les deux murs se rejoignent en angle.
    let joined = false;
    for (const other of plan.nodes) {
      if (other.id === node.id || other.id === o.id || dist(other, n) > reach) continue;
      const end2 = freeEnd(other.id);
      if (!end2 || end2.w === w) continue;
      const den = cross(dir, end2.dir);
      if (Math.abs(den) < 0.3) continue; // parallèles : un mur doublé, pas un angle
      const t = cross(sub(end2.n, n), end2.dir) / den;
      const corner = add(n, mul(dir, t));
      if (dist(corner, n) > reach || dist(corner, end2.n) > reach) continue;
      moveNode(plan, node.id, corner);
      moveNode(plan, other.id, corner);
      mergeNodes(plan, other.id, node.id);
      fixed += 2;
      joined = true;
      break;
    }
    if (joined) continue;

    // 3. Un coin déjà relié, droit devant : on s'y accroche.
    const target = plan.nodes
      .filter((q) => q.id !== node.id && q.id !== o.id && dist(q, n) <= reach && degree(plan, q.id) > 1)
      .filter((q) => dot(norm(sub(q, n)), dir) > 0.7)
      .sort((p, q) => dist(p, n) - dist(q, n))[0];
    if (target) { mergeNodes(plan, node.id, target.id); fixed++; }
  }
  if (fixed) settle(plan, 0.01);
  return fixed;
}

/** Les coins de chaque pièce, pour la retrouver après un geste qui la déforme. */
export function roomShapes(plan: PlanDoc, all = faces(plan)): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of plan.rooms) {
    const f = all.filter((g) => pointInPolygon(r.seed, g.poly)).sort((p, q) => p.area - q.area)[0];
    if (f) out.set(r.id, f.nodes);
  }
  return out;
}

/**
 * Pendant un geste, une pièce garde ses coins même si sa forme change : on
 * replace sa graine au milieu de la forme qui a les mêmes coins (ou la
 * plupart), pour qu'elle garde son nom quand un mur passe par-dessus.
 */
export function reseedRooms(plan: PlanDoc, before: Map<string, string[]>, all = faces(plan)) {
  for (const r of plan.rooms) {
    const nodes = before.get(r.id);
    if (!nodes) continue;
    let best: Face | null = null, score = 0;
    for (const f of all) {
      const s = f.nodes.filter((n) => nodes.includes(n)).length / Math.max(f.nodes.length, nodes.length);
      if (s > score) { score = s; best = f; }
    }
    if (best && score >= 0.5) {
      const p = insidePoint(best.poly);
      r.seed = { x: round3(p.x), y: round3(p.y) };
    }
  }
}
