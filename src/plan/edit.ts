/**
 * plan/edit.ts — les gestes de l'éditeur, sans interface.
 *
 * Aimanter, déplacer, redimensionner, mettre une image à l'échelle : tout ce
 * qui décide d'une position est ici, pur et testé. L'interface (editor-ui.ts)
 * ne fait que traduire la souris en appels à ces fonctions.
 */

import type { PlanDoc, PlanRoom } from './types';

/** Pas de la grille magnétique, en mètres. */
export const GRID = 0.05;

/** Distance sous laquelle un bord vient se coller à un autre, en mètres. */
export const EDGE_SNAP = 0.15;

/** Plus petite pièce acceptée, en mètres. */
export const MIN_ROOM = 0.5;

export const snap = (v: number, step = GRID) => Math.round(v / step) * step;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Colle une valeur au bord le plus proche parmi `edges`, sinon à la grille.
 * C'est ce qui fait que deux pièces dessinées côte à côte partagent vraiment
 * leur mur, au millimètre, sans que l'utilisateur ait à viser.
 */
export function snapTo(v: number, edges: readonly number[], tol = EDGE_SNAP): number {
  let best = v, dist = tol;
  for (const e of edges) {
    const d = Math.abs(v - e);
    if (d < dist) { dist = d; best = e; }
  }
  return r3(dist < tol ? best : snap(v));
}

/** Les abscisses et ordonnées des bords des autres pièces. */
export function edgesOf(rooms: readonly PlanRoom[], except?: string): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  for (const r of rooms) {
    if (r.id === except) continue;
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.d);
  }
  return { xs, ys };
}

/** Une pièce tracée d'un coin à l'autre, aimantée. */
export function roomFromDrag(
  ax: number, ay: number, bx: number, by: number, rooms: readonly PlanRoom[],
): { x: number; y: number; w: number; d: number } {
  const { xs, ys } = edgesOf(rooms);
  const x0 = snapTo(Math.min(ax, bx), xs), x1 = snapTo(Math.max(ax, bx), xs);
  const y0 = snapTo(Math.min(ay, by), ys), y1 = snapTo(Math.max(ay, by), ys);
  return { x: x0, y: y0, w: r3(x1 - x0), d: r3(y1 - y0) };
}

/**
 * Déplace une pièce. On aimante le bord le plus proche d'un bord voisin, de
 * chaque côté, puis on garde la taille.
 */
export function moveRoom(room: PlanRoom, dx: number, dy: number, rooms: readonly PlanRoom[]): { x: number; y: number } {
  const { xs, ys } = edgesOf(rooms, room.id);
  const pick = (start: number, size: number, edges: number[]) => {
    const a = snapTo(start, edges), b = snapTo(start + size, edges) - size;
    // Le bord qui s'est réellement collé à un voisin l'emporte sur la grille.
    const da = edges.some((e) => Math.abs(e - start) < EDGE_SNAP) ? Math.abs(a - start) : Infinity;
    const db = edges.some((e) => Math.abs(e - (start + size)) < EDGE_SNAP) ? Math.abs(b - start) : Infinity;
    if (da === Infinity && db === Infinity) return r3(snap(start));
    return r3(da <= db ? a : b);
  };
  return { x: pick(room.x + dx, room.w, xs), y: pick(room.y + dy, room.d, ys) };
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Redimensionne une pièce par une poignée, bord opposé fixe. */
export function resizeRoom(
  room: PlanRoom, handle: Handle, px: number, py: number, rooms: readonly PlanRoom[],
): { x: number; y: number; w: number; d: number } {
  const { xs, ys } = edgesOf(rooms, room.id);
  let x0 = room.x, x1 = room.x + room.w, y0 = room.y, y1 = room.y + room.d;
  if (handle.includes('w')) x0 = Math.min(snapTo(px, xs), x1 - MIN_ROOM);
  if (handle.includes('e')) x1 = Math.max(snapTo(px, xs), x0 + MIN_ROOM);
  if (handle.includes('n')) y0 = Math.min(snapTo(py, ys), y1 - MIN_ROOM);
  if (handle.includes('s')) y1 = Math.max(snapTo(py, ys), y0 + MIN_ROOM);
  return { x: r3(x0), y: r3(y0), w: r3(x1 - x0), d: r3(y1 - y0) };
}

/** La pièce sous un point ; la plus petite gagne si elles se chevauchent. */
export function roomAt(rooms: readonly PlanRoom[], x: number, y: number): PlanRoom | null {
  let best: PlanRoom | null = null;
  for (const r of rooms) {
    if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.d) continue;
    if (!best || r.w * r.d < best.w * best.d) best = r;
  }
  return best;
}

/**
 * Mise à l'échelle d'une image de plan : on a mesuré `measured` mètres entre
 * deux points de l'image, la cote dit `real`. L'image s'agrandit autour du
 * premier point, qui reste en place sous le curseur.
 */
export function calibrate(
  bg: { x: number; y: number; width: number },
  ax: number, ay: number, measured: number, real: number,
): { x: number; y: number; width: number } {
  if (!(measured > 0) || !(real > 0)) return bg;
  const k = real / measured;
  return { x: r3(ax - (ax - bg.x) * k), y: r3(ay - (ay - bg.y) * k), width: r3(bg.width * k) };
}

/** Nouveau nom de pièce : « Pièce 3 », sans doublon. */
export function nextRoomName(rooms: readonly PlanRoom[], base: string): string {
  let n = rooms.length + 1;
  while (rooms.some((r) => r.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Copie profonde, pour l'historique d'annulation. */
export function clonePlan(plan: PlanDoc): PlanDoc {
  return JSON.parse(JSON.stringify(plan));
}

export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
