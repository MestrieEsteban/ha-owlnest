/**
 * Le toit en pente : un toit à pans (en croupe) sur le contour du dernier
 * niveau, quelle que soit sa forme (rectangle, L, T…).
 *
 * C'est le « squelette droit » du contour : chaque façade recule vers
 * l'intérieur à la même vitesse en montant, comme un pan de toit. Quand une
 * façade disparaît (deux arêtes se rejoignent) ou qu'un angle rentrant vient
 * toucher une autre façade (le contour se coupe en deux), on note l'instant,
 * et on repart. Chaque façade laisse derrière elle des bandes : ce sont les
 * pans du toit.
 */
import type { PlanDoc } from './types';
import { type Pt, add, mul, sub, dot, norm, area } from './geometry';
import { faces, thicknessOf, enclosed, isBoundary } from './graph';

export type Quad = [Pt, Pt, Pt, Pt];
/** Un pan : quatre coins (le dernier peut répéter le troisième), à deux hauteurs. */
export interface RoofStrip { pts: Quad; h0: number; h1: number }

const EPS = 1e-7;

/** Un sommet du contour qui recule, et la normale intérieure de la façade qui part de lui. */
interface V { p: Pt; n: Pt }

const inward = (a: Pt, b: Pt): Pt => { const d = norm(sub(b, a)); return { x: -d.y, y: d.x }; };

/** Vitesse d'un sommet : il suit ses deux façades, chacune reculant d'une unité par unité de temps. */
function speed(nIn: Pt, nOut: Pt): Pt {
  const k = 1 + dot(nIn, nOut);
  // Deux façades presque opposées : un pic, il ne bouge (presque) plus.
  if (k < 1e-6) return { x: 0, y: 0 };
  return mul(add(nIn, nOut), 1 / k);
}

const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;

/** Le contour dans le sens trigonométrique, sans sommets en double. */
function clean(poly: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) out.pop();
  }
  return area(out) < 0 ? out.reverse() : out;
}

/**
 * Retire les pointes de largeur nulle : quand deux façades face à face se
 * rejoignent (une aile qui se ferme en faîtage), leur sommet commun n'a plus
 * de raison d'être. Le sommet d'avant reprend la façade qui suit.
 */
function prune(vs: V[]): V[] {
  const out = [...vs];
  for (let guard = 0; guard < 100 && out.length >= 3; guard++) {
    const m = out.length;
    const i = out.findIndex((v, k) => {
      const prev = out[(k - 1 + m) % m];
      const close = Math.hypot(prev.p.x - v.p.x, prev.p.y - v.p.y) < 1e-7;
      return close || dot(prev.n, v.n) < -1 + 1e-6;
    });
    if (i < 0) break;
    const prev = (i - 1 + m) % m;
    out[prev] = { p: out[prev].p, n: out[i].n };
    out.splice(i, 1);
  }
  return out;
}

/** Coupe le contour au sommet `r`, posé sur la façade `e` (qui part du sommet `e`). */
function cut(vs: V[], r: number, e: number): [V[], V[]] {
  const m = vs.length, f = (e + 1) % m, p = vs[r].p;
  const one: V[] = [], two: V[] = [];
  // De r vers e : r (repart par sa façade), …, e (repart par la façade coupée, jusqu'à r).
  for (let i = r; ; i = (i + 1) % m) {
    one.push(i === r ? { p, n: vs[r].n } : vs[i]);
    if (i === e) break;
  }
  // De f vers r : f, …, le sommet avant r, puis r (repart par la façade coupée, vers f).
  for (let i = f; ; i = (i + 1) % m) {
    if (i === r) { two.push({ p, n: vs[e].n }); break; }
    two.push(vs[i]);
  }
  return [one, two];
}

/** Distance d'un point à un segment. */
function toSegment(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const s = l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const q = add(a, mul(ab, s));
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/**
 * Après un évènement, plusieurs choses ont pu arriver en même temps (deux
 * façades parallèles qui se superposent, un sommet qui en touche un autre) :
 * tout sommet posé sur une façade qui n'est pas la sienne coupe le contour à
 * cet endroit. Il ne reste que des contours propres, qui ont une aire.
 */
function settle(start: V[]): V[][] {
  const done: V[][] = [];
  const todo = [prune(start)];
  for (let guard = 0; guard < 200 && todo.length; guard++) {
    const vs = todo.pop()!;
    if (vs.length < 3 || Math.abs(area(vs.map((v) => v.p))) < 1e-9) continue;
    const m = vs.length;
    let hit: [number, number] | null = null;
    for (let r = 0; r < m && !hit; r++) {
      for (let e = 0; e < m; e++) {
        if (e === r || e === (r - 1 + m) % m) continue;
        if (toSegment(vs[r].p, vs[e].p, vs[(e + 1) % m].p) < 1e-6) { hit = [r, e]; break; }
      }
    }
    if (!hit) {
      // Une façade garde sa direction en reculant : sa normale se relit sur
      // la géométrie, ce qui corrige celles qu'une coupe aurait mal attribuées.
      done.push(vs.map((v, i) => {
        const q = vs[(i + 1) % m].p;
        return Math.hypot(q.x - v.p.x, q.y - v.p.y) > 1e-6 ? { p: v.p, n: inward(v.p, q) } : v;
      }));
      continue;
    }
    for (const part of cut(vs, hit[0], hit[1])) todo.push(prune(part));
  }
  return done;
}

/**
 * Les pans du toit d'un contour (sens quelconque), pour une pente `slope`
 * (hauteur par mètre de recul). Hauteurs relatives au bas du toit.
 */
export function hipRoof(outline: Pt[], slope: number): RoofStrip[] {
  const strips: RoofStrip[] = [];
  const start = clean(outline);
  if (start.length < 3) return strips;
  // Un contour dans le sens trigonométrique : l'intérieur est à gauche de chaque façade.
  const ring = (pts: Pt[]): V[] => pts.map((p, i) => ({ p, n: inward(p, pts[(i + 1) % pts.length]) }));
  const work: { vs: V[]; t: number }[] = [{ vs: ring(start), t: 0 }];

  for (let guard = 0; guard < 2000 && work.length; guard++) {
    const { vs, t } = work.pop()!;
    if (vs.length < 3) continue;
    const m = vs.length;
    const vel = vs.map((v, i) => speed(vs[(i - 1 + m) % m].n, v.n));

    // Le prochain évènement.
    let dt = Infinity;
    let kind: 'edge' | 'split' | null = null;
    let at = -1, other = -1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const d = sub(vs[j].p, vs[i].p);
      const L = Math.hypot(d.x, d.y);
      if (L < EPS) { dt = 0; kind = 'edge'; at = i; break; }
      const u = mul(d, 1 / L);
      const rate = dot(sub(vel[i], vel[j]), u);
      if (rate > EPS) {
        const tt = L / rate;
        if (tt < dt) { dt = tt; kind = 'edge'; at = i; }
      }
    }
    for (let r = 0; r < m; r++) {
      const prev = vs[(r - 1 + m) % m];
      // Seuls les angles rentrants (tournant à droite) peuvent couper une façade.
      if (cross(sub(vs[r].p, prev.p), sub(vs[(r + 1) % m].p, vs[r].p)) > -EPS) continue;
      for (let e = 0; e < m; e++) {
        const f = (e + 1) % m;
        if (e === r || f === r || e === (r - 1 + m) % m) continue;
        const ne = vs[e].n;
        // La façade e recule : n·x = n·a + t. Le sommet la rejoint quand n·(p + v t) = n·a + t.
        const den = dot(ne, vel[r]) - 1;
        if (Math.abs(den) < EPS) continue;
        const tt = (dot(ne, vs[e].p) - dot(ne, vs[r].p)) / den;
        if (!(tt > EPS) || tt >= dt) continue;
        // Le point touché doit tomber entre les deux bouts de la façade à cet instant.
        const hit = add(vs[r].p, mul(vel[r], tt));
        const a = add(vs[e].p, mul(vel[e], tt)), b = add(vs[f].p, mul(vel[f], tt));
        const ab = sub(b, a), len2 = dot(ab, ab);
        if (len2 < EPS) continue;
        const s = dot(sub(hit, a), ab) / len2;
        if (s < -1e-6 || s > 1 + 1e-6) continue;
        dt = tt; kind = 'split'; at = r; other = e;
      }
    }
    if (!kind || !isFinite(dt)) continue;

    // Chaque façade avance jusqu'à l'évènement : une bande de toit.
    const moved = vs.map((v, i) => ({ p: add(v.p, mul(vel[i], dt)), n: v.n }));
    const t1 = t + dt;
    if (dt > EPS) {
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        strips.push({ pts: [vs[i].p, vs[j].p, moved[j].p, moved[i].p], h0: t * slope, h1: t1 * slope });
      }
    }

    if (kind === 'edge') {
      // La façade `at` a disparu : ses deux bouts n'en font plus qu'un.
      const j = (at + 1) % m;
      const merged: V = { p: mul(add(moved[at].p, moved[j].p), 0.5), n: moved[j].n };
      const next = moved.filter((_, i) => i !== at && i !== j);
      next.splice(at < j ? at : next.length, 0, merged);
      // Un contour sans aire (deux façades face à face) est fini.
      for (const part of settle(next)) work.push({ vs: part, t: t1 });
    } else {
      // L'angle `at` touche la façade `other` : le contour se coupe en deux.
      for (const half of cut(moved, at, other)) for (const part of settle(half)) work.push({ vs: part, t: t1 });
    }
  }
  return strips;
}

/**
 * Le contour extérieur d'un plan : les arêtes des pièces qui n'appartiennent
 * qu'à une seule pièce, chaînées en boucle (la plus grande, sans les cours
 * intérieures), au nu extérieur des murs.
 */
export function planOutline(plan: PlanDoc): Pt[] {
  // Seules les pièces fermées ont un toit : un balcon ou une terrasse (murs
  // bas sur la plus grande partie du tour) reste à ciel ouvert.
  const fs = faces(plan).filter((f) => enclosed(plan, f.nodes));
  const count = new Map<string, number>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const f of fs) f.nodes.forEach((a, i) => { const k = key(a, f.nodes[(i + 1) % f.nodes.length]); count.set(k, (count.get(k) ?? 0) + 1); });
  const next = new Map<string, string[]>();
  for (const f of fs) f.nodes.forEach((a, i) => {
    const b = f.nodes[(i + 1) % f.nodes.length];
    if (count.get(key(a, b)) !== 1) return;
    next.set(a, [...(next.get(a) ?? []), b]);
  });
  const pos = new Map(plan.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const used = new Set<string>();
  let best: Pt[] = [];
  for (const [s] of next) {
    if (used.has(s)) continue;
    const loop: string[] = [];
    let cur: string | undefined = s;
    while (cur && !used.has(cur)) {
      used.add(cur);
      loop.push(cur);
      cur = next.get(cur)?.find((n) => !used.has(n));
    }
    const poly = loop.map((id) => pos.get(id)!).filter(Boolean);
    if (Math.abs(area(poly)) > Math.abs(area(best))) best = poly;
  }
  if (best.length < 3) return [];
  // Au nu extérieur des murs : on recule chaque façade de la demi-épaisseur.
  const half = (Math.max(...plan.walls.filter((w) => !isBoundary(plan, w)).map((w) => thicknessOf(plan, w)), plan.wallThickness ?? 0.15)) / 2;
  return offset(clean(best), half);
}

/** Le contour poussé vers l'extérieur de `d` (petites distances : pas d'évènement). */
export function offset(poly: Pt[], d: number): Pt[] {
  const m = poly.length;
  const ns = poly.map((p, i) => inward(p, poly[(i + 1) % m]));
  return poly.map((p, i) => add(p, mul(speed(ns[(i - 1 + m) % m], ns[i]), -d)));
}
