/**
 * plan/footprint.ts — la semelle de chaque mur, vue de dessus.
 *
 * Un mur est un trait épais. Là où plusieurs murs se rejoignent, chacun est
 * coupé en biais (en onglet) pour que les angles se ferment proprement, quel
 * que soit l'angle : un L, un T, une étoile de murs. On le calcule coin par
 * coin : autour d'un coin, les murs sont triés par angle, et chaque bord d'un
 * mur s'arrête là où il rencontre le bord du mur voisin.
 *
 * Chaque extrémité passe aussi par le coin lui-même. Sans ce point, un T
 * laissait un petit triangle vide : les deux morceaux du mur droit, coupés en
 * biais vers le mur qui arrive, et ce mur, arrêté à leur bord, ne se
 * touchaient pas au centre.
 */

import type { PlanDoc } from './types';
import { type Pt, sub, add, mul, norm, perp, dist, lineCross, cross } from './geometry';
import { thicknessOf, isBoundary } from './graph';

interface End {
  wall: string;
  /** Direction du mur, en partant du coin. */
  dir: Pt;
  half: number;
}

/**
 * Pour chaque mur, sa semelle : `[a gauche, b gauche, (coin b), b droite,
 * a droite, (coin a)]`, où gauche et droite se lisent en allant de `a` vers `b`.
 */
export function wallFootprints(plan: PlanDoc): Map<string, Pt[]> {
  const pos = new Map(plan.nodes.map((n) => [n.id, n as Pt]));
  const ends = new Map<string, End[]>();
  for (const w of plan.walls) {
    const a = pos.get(w.a), b = pos.get(w.b);
    // Une limite de pièce n'a pas d'épaisseur : les murs qui la touchent s'arrêtent net.
    if (!a || !b || dist(a, b) < 1e-6 || isBoundary(plan, w)) continue;
    const half = thicknessOf(plan, w) / 2;
    ends.set(w.a, [...(ends.get(w.a) ?? []), { wall: w.id, dir: norm(sub(b, a)), half }]);
    ends.set(w.b, [...(ends.get(w.b) ?? []), { wall: w.id, dir: norm(sub(a, b)), half }]);
  }

  // Coins de chaque extrémité de mur : [gauche, droite] vus en partant du coin,
  // et le coin lui-même quand il dépasse de la coupe.
  const corner = new Map<string, [Pt, Pt, Pt?]>();
  for (const [nodeId, list] of ends) {
    const n = pos.get(nodeId)!;
    list.sort((p, q) => Math.atan2(p.dir.y, p.dir.x) - Math.atan2(q.dir.y, q.dir.x));
    list.forEach((e, i) => {
      const left = add(n, mul(perp(e.dir), e.half));
      const right = add(n, mul(perp(e.dir), -e.half));
      if (list.length === 1) { corner.set(`${e.wall}@${nodeId}`, [left, right]); return; }
      const next = list[(i + 1) % list.length];
      const prev = list[(i - 1 + list.length) % list.length];
      // Bord gauche contre le bord droit du voisin suivant, et inversement.
      const nextRight = add(n, mul(perp(next.dir), -next.half));
      const prevLeft = add(n, mul(perp(prev.dir), prev.half));
      const limit = 4 * Math.max(e.half, next.half, prev.half);
      const l = lineCross(left, e.dir, nextRight, next.dir);
      const r = lineCross(right, e.dir, prevLeft, prev.dir);
      // Murs alignés (pas d'intersection) ou angle très aigu : coupe droite.
      const cl = l && dist(l, n) < limit ? l : left;
      const cr = r && dist(r, n) < limit ? r : right;
      // Un coin aligné avec la coupe (angle en L) n'ajoute rien.
      const hub = Math.abs(cross(sub(cl, n), sub(cr, n))) > 1e-9 ? n : undefined;
      corner.set(`${e.wall}@${nodeId}`, [cl, cr, hub]);
    });
  }

  const out = new Map<string, Pt[]>();
  for (const w of plan.walls) {
    const ca = corner.get(`${w.id}@${w.a}`), cb = corner.get(`${w.id}@${w.b}`);
    if (!ca || !cb) continue;
    // En b, le mur part dans l'autre sens : sa gauche est notre droite.
    const poly = [ca[0], cb[1]];
    if (cb[2]) poly.push(cb[2]);
    poly.push(cb[0], ca[1]);
    if (ca[2]) poly.push(ca[2]);
    out.set(w.id, poly);
  }
  return out;
}

/**
 * Jusqu'où s'étend le coin à chaque bout d'un mur, mesuré le long du mur
 * depuis son départ `a` : `[fin du coin de départ, début du coin d'arrivée]`.
 *
 * Au coin, la semelle d'un mur dépasse son extrémité en onglet et partage
 * l'angle avec le mur voisin. Ce morceau-là appartient à l'angle : quand le
 * mur s'abaisse mais que son voisin reste debout, il reste entier, et l'angle
 * du mur debout garde une arête nette au lieu d'une encoche en biais (voir
 * low-walls.ts). Un bout coupé droit (sans voisin, ou prolongé tout droit) n'a
 * pas de coin : `0` au départ, la longueur du mur à l'arrivée.
 */
export function cornerStops(foot: readonly Pt[], a: Pt, b: Pt): [number, number] {
  const L = dist(a, b);
  const dir = norm(sub(b, a));
  let stopA = 0, stopB = L;
  for (const p of foot) {
    const t = (p.x - a.x) * dir.x + (p.y - a.y) * dir.y;
    if (t < L / 2) stopA = Math.max(stopA, t);
    else stopB = Math.min(stopB, t);
  }
  // Un coin ne mange jamais plus que la moitié du mur.
  return [Math.min(stopA, L / 2), Math.max(stopB, L / 2)];
}
