/**
 * plan/walls.ts — les murs, déduits des pièces.
 *
 * On ne dessine pas de murs : on dessine des pièces, et chaque bord de pièce
 * est un mur. Deux pièces côte à côte partagent leur bord : il ne doit y avoir
 * qu'un mur, pas deux murs collés. On rassemble donc les bords alignés et on
 * fusionne ceux qui se chevauchent ou se touchent.
 *
 * Tout est pur et sans three.js : testable, et réutilisé tel quel par
 * l'éditeur 2D comme par la construction 3D.
 */

import type { PlanDoc, PlanOpening, PlanRoom } from './types';

/** Tolérance de comparaison, en mètres : le millimètre. */
const EPS = 1e-3;

/**
 * Un mur : un segment horizontal (`axis: 'x'`, le long de x, à `y = at`) ou
 * vertical (`axis: 'y'`, le long de y, à `x = at`), de `from` à `to`.
 */
export interface Wall {
  id: string;
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
  height: number;
  thickness: number;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Identifiant stable d'un mur : son axe, sa position et son début. */
export function wallId(axis: 'x' | 'y', at: number, from: number): string {
  return `${axis}:${round(at).toFixed(3)}:${round(from).toFixed(3)}`;
}

/** Les quatre bords d'une pièce. */
function edges(r: PlanRoom): { axis: 'x' | 'y'; at: number; from: number; to: number }[] {
  return [
    { axis: 'x', at: r.y, from: r.x, to: r.x + r.w },
    { axis: 'x', at: r.y + r.d, from: r.x, to: r.x + r.w },
    { axis: 'y', at: r.x, from: r.y, to: r.y + r.d },
    { axis: 'y', at: r.x + r.w, from: r.y, to: r.y + r.d },
  ];
}

export function wallsOf(plan: PlanDoc): Wall[] {
  const lines = new Map<string, { axis: 'x' | 'y'; at: number; spans: [number, number][] }>();
  for (const room of plan.rooms) {
    if (!(room.w > EPS && room.d > EPS)) continue;
    for (const e of edges(room)) {
      const key = `${e.axis}:${round(e.at)}`;
      const line = lines.get(key) ?? { axis: e.axis, at: round(e.at), spans: [] };
      line.spans.push([Math.min(e.from, e.to), Math.max(e.from, e.to)]);
      lines.set(key, line);
    }
  }

  const walls: Wall[] = [];
  for (const line of lines.values()) {
    const spans = line.spans.sort((a, b) => a[0] - b[0]);
    let cur: [number, number] | null = null;
    const flush = () => {
      if (!cur) return;
      const id = wallId(line.axis, line.at, cur[0]);
      const o = plan.walls?.[id];
      walls.push({
        id, axis: line.axis, at: line.at, from: round(cur[0]), to: round(cur[1]),
        height: o?.height ?? plan.wallHeight,
        thickness: o?.thickness ?? plan.wallThickness,
      });
    };
    for (const s of spans) {
      if (cur && s[0] <= cur[1] + EPS) cur[1] = Math.max(cur[1], s[1]);
      else { flush(); cur = [s[0], s[1]]; }
    }
    flush();
  }
  return walls;
}

/** Une ouverture rattachée à son mur : position du milieu le long du mur. */
export interface Attached {
  opening: PlanOpening;
  wall: Wall;
  /** Abscisse du milieu, le long du mur (en x ou en y selon son axe). */
  center: number;
}

/**
 * Le mur qui porte une ouverture : le plus proche, à condition qu'elle tienne
 * entière dans sa longueur. Une ouverture qui ne tient plus (pièce réduite)
 * n'est rattachée à rien : elle disparaît de la 3D sans casser le reste.
 */
export function wallFor(o: PlanOpening, walls: readonly Wall[], tolerance = 0.3): Attached | null {
  let best: Attached | null = null;
  let bestDist = tolerance;
  for (const w of walls) {
    const along = w.axis === 'x' ? o.x : o.y;
    const across = w.axis === 'x' ? o.y : o.x;
    const dist = Math.abs(across - w.at);
    if (dist > bestDist) continue;
    if (along - o.width / 2 < w.from - EPS || along + o.width / 2 > w.to + EPS) continue;
    bestDist = dist;
    best = { opening: o, wall: w, center: along };
  }
  return best;
}

/**
 * Point le plus proche sur un mur, pour poser une ouverture là où l'on clique.
 * Rend `null` si aucun mur n'est assez proche ou assez long.
 */
export function snapToWall(
  x: number, y: number, width: number, walls: readonly Wall[], tolerance = 0.4,
): { wall: Wall; x: number; y: number } | null {
  let best: { wall: Wall; x: number; y: number } | null = null;
  let bestDist = tolerance;
  for (const w of walls) {
    if (w.to - w.from < width + EPS) continue;
    const along = Math.min(Math.max(w.axis === 'x' ? x : y, w.from + width / 2), w.to - width / 2);
    const across = w.axis === 'x' ? y : x;
    const dist = Math.abs(across - w.at);
    if (dist > bestDist) continue;
    bestDist = dist;
    best = { wall: w, x: round(w.axis === 'x' ? along : w.at), y: round(w.axis === 'x' ? w.at : along) };
  }
  return best;
}

/** Un bloc de mur à construire : de `a` à `b` le long du mur, de `bottom` à `top`. */
export interface WallPiece {
  a: number;
  b: number;
  bottom: number;
  top: number;
}

/**
 * Découpe un mur autour de ses ouvertures : pleine hauteur entre elles,
 * allège sous une fenêtre, linteau au-dessus. Uniquement des blocs : pas de
 * soustraction de volumes, donc une géométrie toujours propre.
 */
export function wallPieces(wall: Wall, holes: readonly { center: number; width: number; sill: number; height: number }[]): WallPiece[] {
  const sorted = [...holes]
    .map((h) => ({ a: h.center - h.width / 2, b: h.center + h.width / 2, sill: h.sill, top: Math.min(h.sill + h.height, wall.height) }))
    .sort((p, q) => p.a - q.a);
  const pieces: WallPiece[] = [];
  let cursor = wall.from;
  for (const h of sorted) {
    if (h.a > cursor + EPS) pieces.push({ a: cursor, b: h.a, bottom: 0, top: wall.height });
    if (h.sill > EPS) pieces.push({ a: h.a, b: h.b, bottom: 0, top: h.sill });
    if (h.top < wall.height - EPS) pieces.push({ a: h.a, b: h.b, bottom: h.top, top: wall.height });
    cursor = Math.max(cursor, h.b);
  }
  if (wall.to > cursor + EPS) pieces.push({ a: cursor, b: wall.to, bottom: 0, top: wall.height });
  return pieces;
}

/** Surface habitable d'une pièce : entre les faces des murs, pas entre leurs axes. */
export function netArea(room: PlanRoom, thickness: number): number {
  return Math.max(0, room.w - thickness) * Math.max(0, room.d - thickness);
}
