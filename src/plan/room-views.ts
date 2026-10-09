/**
 * Les pièces du plan, prêtes pour la carte : un bouton par pièce, qui pose la
 * caméra au-dessus d'elle. Rien à enregistrer : les pièces viennent du dessin
 * (ou de l'import Sweet Home 3D), et suivent chaque retouche.
 *
 * Tout est exprimé dans le repère de la scène : le plan y est décalé de son
 * `origin` (voir PlanDoc.origin), x du plan vers x de la scène, y du plan vers
 * z.
 */
import type { PlanDoc } from './types';
import { faces, roomPolygon } from './graph';
import { centroid, pointInPolygon, type Pt } from './geometry';

export interface RoomView {
  id: string;
  name: string;
  /** Contour, dans le repère du plan. */
  poly: Pt[];
  /** Surface, en m². */
  area: number;
}

/** Plus petite pièce proposée : un placard n'a pas besoin de son bouton. */
const MIN_AREA = 1.5;

/**
 * Les pièces du plan, de la plus grande à la plus petite : le séjour d'abord,
 * les toilettes à la fin. Deux pièces du même nom sont numérotées.
 */
export function planRooms(plan: PlanDoc): RoomView[] {
  const all = faces(plan);
  const out: RoomView[] = [];
  for (const r of plan.rooms) {
    const poly = roomPolygon(plan, r.id, all);
    if (!poly) continue;
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      a += p.x * q.y - q.x * p.y;
    }
    const area = Math.abs(a) / 2;
    if (area < MIN_AREA) continue;
    out.push({ id: r.id, name: r.name || r.id, poly, area });
  }
  out.sort((a, b) => b.area - a.area);
  const seen = new Map<string, number>();
  for (const r of out) {
    const n = (seen.get(r.name) ?? 0) + 1;
    seen.set(r.name, n);
    if (n > 1) r.name = `${r.name} ${n}`;
  }
  return out;
}

/** La pièce qui contient un point de la scène, s'il y en a une. */
export function roomOfPoint(rooms: RoomView[], origin: Pt, x: number, z: number): RoomView | null {
  const p = { x: x + origin.x, y: z + origin.y };
  // La plus petite d'abord : une pièce peut être dessinée dans une autre.
  return [...rooms].sort((a, b) => a.area - b.area).find((r) => pointInPolygon(p, r.poly)) ?? null;
}

export interface CameraPose {
  pos: [number, number, number];
  target: [number, number, number];
}

/**
 * Où poser la caméra pour voir une pièce entière.
 *
 * Même regard que la vue d'ensemble (de trois quarts, à 50° au-dessus de
 * l'horizon), mais rapproché pour que la pièce, murs compris, remplisse
 * l'écran. `visible` est la part de la largeur de la carte que rien ne couvre.
 */
export function roomCamera(
  room: RoomView,
  origin: Pt,
  opts: { fovDeg: number; aspect: number; wallHeight: number; visible?: number },
): CameraPose {
  const c = centroid(room.poly);
  // Rayon de la pièce vue du centre, hauteur des murs comprise.
  let r = 0;
  for (const p of room.poly) r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y));
  const radius = Math.max(1.2, Math.hypot(r, opts.wallHeight / 2));
  const vfov = (opts.fovDeg * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * opts.aspect * Math.max(opts.visible ?? 1, 0.2));
  const dist = Math.max(3, (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 0.9);
  const elevation = (50 * Math.PI) / 180;
  const azimuth = (25 * Math.PI) / 180;
  const tx = c.x - origin.x, tz = c.y - origin.y;
  return {
    target: [tx, 0, tz],
    pos: [
      tx + Math.sin(azimuth) * Math.cos(elevation) * dist,
      Math.sin(elevation) * dist,
      tz + Math.cos(azimuth) * Math.cos(elevation) * dist,
    ],
  };
}
