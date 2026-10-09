/**
 * plan/migrate.ts — les plans dessinés avec la première version de l'éditeur.
 *
 * Elle ne connaissait que des pièces rectangulaires, et des ouvertures posées
 * à un point du plan. On redessine les rectangles en murs, et chaque ouverture
 * retrouve le mur sous son point.
 */

import type { PlanDoc, PlanOpening } from './types';
import { addRect, wallAt, reconcileRooms, newId } from './graph';
import { round3 } from './geometry';

interface V1Room { id: string; name: string; floor?: string; x: number; y: number; w: number; d: number }
interface V1Opening extends Omit<PlanOpening, 'wall' | 'offset'> { x: number; y: number }
interface V1Plan {
  version: 1;
  wallHeight: number;
  wallThickness: number;
  rooms: V1Room[];
  openings: V1Opening[];
  background?: PlanDoc['background'];
  origin?: PlanDoc['origin'];
}

/** Le plan au format courant ; celui d'une version plus ancienne est converti. */
export function migratePlan(raw: unknown): PlanDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<PlanDoc> & { version?: number };
  if (p.version === 2) return p as PlanDoc;
  if (p.version !== 1 && p.version !== undefined) return null;
  const old = raw as V1Plan;
  const plan: PlanDoc = {
    version: 2,
    wallHeight: old.wallHeight ?? 2.5,
    wallThickness: old.wallThickness ?? 0.15,
    nodes: [], walls: [], rooms: [], openings: [],
    background: old.background,
    origin: old.origin,
  };
  for (const r of old.rooms ?? []) addRect(plan, r.x, r.y, r.x + r.w, r.y + r.d);
  plan.rooms = (old.rooms ?? []).map((r) => ({
    id: r.id, name: r.name, floor: r.floor,
    seed: { x: round3(r.x + r.w / 2), y: round3(r.y + r.d / 2) },
  }));
  let n = plan.rooms.length;
  reconcileRooms(plan, () => `Room ${++n}`, () => '#c9b08a');
  for (const o of old.openings ?? []) {
    const hit = wallAt(plan, o, 0.3);
    if (!hit) continue;
    const { x: _x, y: _y, ...rest } = o;
    plan.openings.push({ ...rest, id: o.id ?? newId('o'), wall: hit.wall.id, offset: round3(hit.offset) });
  }
  return plan;
}
