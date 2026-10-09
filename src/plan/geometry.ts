/**
 * plan/geometry.ts — calculs plans (2D) du dessin : polygones, segments,
 * intersections. Aucune dépendance : tout est testé à part.
 *
 * Repère du dessin : `x` vers la droite, `y` vers le bas de l'écran, en mètres.
 */

export interface Pt { x: number; y: number }

export const EPS = 1e-6;

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Pt): Pt => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
/** Normale à gauche (sens trigonométrique, repère y vers le bas : à droite à l'écran). */
export const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });

/** Aire signée (positive si les sommets tournent dans le sens des x vers les y). */
export function area(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return s / 2;
}

export function centroid(poly: readonly Pt[]): Pt {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    cx += (poly[j].x + poly[i].x) * f;
    cy += (poly[j].y + poly[i].y) * f;
    a += f;
  }
  if (Math.abs(a) < EPS) return poly[0] ?? { x: 0, y: 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Un point bien à l'intérieur d'un polygone : le centre de gravité s'il y est,
 * sinon le milieu du plus long segment horizontal intérieur. Sert à poser le
 * nom d'une pièce en L, dont le centre de gravité peut tomber dehors.
 */
export function insidePoint(poly: readonly Pt[]): Pt {
  const c = centroid(poly);
  if (pointInPolygon(c, poly)) return c;
  let ymin = Infinity, ymax = -Infinity;
  for (const p of poly) { ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); }
  let best: Pt = c, bestLen = 0;
  for (let k = 1; k < 20; k++) {
    const y = ymin + ((ymax - ymin) * k) / 20;
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > bestLen) { bestLen = xs[i + 1] - xs[i]; best = { x: (xs[i] + xs[i + 1]) / 2, y }; }
    }
  }
  return best;
}

/** Projection d'un point sur un segment : paramètre `t` (0 à 1, borné) et point projeté. */
export function project(p: Pt, a: Pt, b: Pt): { t: number; p: Pt; d: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const q = add(a, mul(ab, t));
  return { t, p: q, d: dist(p, q) };
}

/**
 * Intersection de deux segments, strictement à l'intérieur des deux
 * (extrémités exclues) : c'est là qu'un mur en croise un autre.
 */
export function segmentCross(a: Pt, b: Pt, c: Pt, d: Pt): { t: number; u: number; p: Pt } | null {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  const m = 1e-4;
  if (t <= m || t >= 1 - m || u <= m || u >= 1 - m) return null;
  return { t, u, p: add(a, mul(r, t)) };
}

/** Intersection de deux droites (point + direction), ou `null` si parallèles. */
export function lineCross(p: Pt, r: Pt, q: Pt, s: Pt): Pt | null {
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(q, p), s) / den;
  return add(p, mul(r, t));
}

/**
 * Coupe un polygone convexe entre deux plans perpendiculaires à `dir`
 * (abscisses `min` et `max` le long de `dir`, depuis `origin`). Sert à
 * découper la semelle d'un mur autour d'une porte.
 */
export function clipAlong(poly: readonly Pt[], origin: Pt, dir: Pt, min: number, max: number): Pt[] {
  const at = (p: Pt) => dot(sub(p, origin), dir);
  const cut = (pts: Pt[], keep: (v: number) => boolean, edge: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const va = at(a), vb = at(b);
      if (keep(va)) out.push(a);
      if (keep(va) !== keep(vb)) {
        const k = (edge - va) / (vb - va);
        out.push(add(a, mul(sub(b, a), k)));
      }
    }
    return out;
  };
  let pts = cut([...poly], (v) => v >= min - 1e-9, min);
  pts = cut(pts, (v) => v <= max + 1e-9, max);
  return pts;
}

export const round3 = (v: number) => Math.round(v * 1000) / 1000;
