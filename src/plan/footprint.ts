/**
 * plan/footprint.ts — la semelle de chaque mur, vue de dessus.
 *
 * Un mur est un trait épais. Là où plusieurs murs se rejoignent, chacun est
 * coupé en biais (en onglet) pour que les angles se ferment proprement, quel
 * que soit l'angle : un L, un T, une étoile de murs. On le calcule coin par
 * coin : autour d'un coin, les murs sont triés par angle, et chaque bord d'un
 * mur s'arrête là où il rencontre le bord du mur voisin.
 */

import type { PlanDoc } from './types';
import { type Pt, sub, add, mul, norm, perp, dist, lineCross } from './geometry';
import { thicknessOf } from './graph';

interface End {
  wall: string;
  /** Direction du mur, en partant du coin. */
  dir: Pt;
  half: number;
}

/**
 * Pour chaque mur, sa semelle : `[a gauche, b gauche, b droite, a droite]`,
 * où gauche et droite se lisent en allant de `a` vers `b`.
 */
export function wallFootprints(plan: PlanDoc): Map<string, Pt[]> {
  const pos = new Map(plan.nodes.map((n) => [n.id, n as Pt]));
  const ends = new Map<string, End[]>();
  for (const w of plan.walls) {
    const a = pos.get(w.a), b = pos.get(w.b);
    if (!a || !b || dist(a, b) < 1e-6) continue;
    const half = thicknessOf(plan, w) / 2;
    ends.set(w.a, [...(ends.get(w.a) ?? []), { wall: w.id, dir: norm(sub(b, a)), half }]);
    ends.set(w.b, [...(ends.get(w.b) ?? []), { wall: w.id, dir: norm(sub(a, b)), half }]);
  }

  // Coins de chaque extrémité de mur : [gauche, droite] vus en partant du coin.
  const corner = new Map<string, [Pt, Pt]>();
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
      corner.set(`${e.wall}@${nodeId}`, [
        l && dist(l, n) < limit ? l : left,
        r && dist(r, n) < limit ? r : right,
      ]);
    });
  }

  const out = new Map<string, Pt[]>();
  for (const w of plan.walls) {
    const ca = corner.get(`${w.id}@${w.a}`), cb = corner.get(`${w.id}@${w.b}`);
    if (!ca || !cb) continue;
    // En b, le mur part dans l'autre sens : sa gauche est notre droite.
    out.set(w.id, [ca[0], cb[1], cb[0], ca[1]]);
  }
  return out;
}
