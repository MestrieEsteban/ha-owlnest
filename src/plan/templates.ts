/**
 * plan/templates.ts — des logements tout prêts, pour ne pas partir d'une page
 * blanche : on choisit le plus proche du sien, puis on pousse les murs.
 */

import { t } from '../i18n';
import type { PlanDoc, OpeningKind } from './types';
import { emptyPlan, OPENING_DEFAULTS } from './types';
import { addRect, wallAt, reconcileRooms, newId } from './graph';
import { round3 } from './geometry';
import { ROOM_TYPES, type RoomType } from './rooms';

export type TemplateId = 'studio' | 't2' | 't3' | 'house';

interface Spec {
  rooms: [RoomType, number, number, number, number][];
  openings: [OpeningKind, number, number, Partial<{ hinge: 'start' | 'end'; swing: 'front' | 'back'; double: boolean }>?][];
}

const SPECS: Record<TemplateId, Spec> = {
  studio: {
    rooms: [
      ['living', 0, 0, 5, 4.5],
      ['bathroom', 5, 0, 7.2, 2.2],
      ['entrance', 5, 2.2, 7.2, 4.5],
    ],
    openings: [
      ['door', 6.1, 4.5],
      ['door', 6.1, 2.2, { swing: 'back' }],
      ['passage', 5, 3.4],
      ['window', 2.5, 0, { double: true }],
      ['window', 0, 2.2],
    ],
  },
  t2: {
    rooms: [
      ['living', 0, 0, 5.5, 5],
      ['kitchen', 5.5, 0, 8.5, 3],
      ['entrance', 5.5, 3, 8.5, 5],
      ['bedroom', 0, 5, 4.5, 8.5],
      ['bathroom', 4.5, 5, 7, 8.5],
      ['toilet', 7, 5, 8.5, 6.6],
    ],
    openings: [
      ['door', 8.5, 4, { hinge: 'end' }],
      ['passage', 5.5, 4],
      ['passage', 7, 3],
      ['door', 3.6, 5, { swing: 'back' }],
      ['door', 5.0, 5, { swing: 'back' }],
      ['door', 7.75, 5, { swing: 'back' }],
      ['slider', 2.75, 0],
      ['window', 7, 0],
      ['window', 2.2, 8.5, { double: true }],
    ],
  },
  t3: {
    rooms: [
      ['living', 0, 0, 6, 5],
      ['kitchen', 6, 0, 9.5, 3.2],
      ['entrance', 6, 3.2, 9.5, 5],
      ['bedroom', 0, 5, 4, 8.8],
      ['bedroom', 4, 5, 7.5, 8.8],
      ['bathroom', 7.5, 5, 9.5, 7.4],
      ['toilet', 7.5, 7.4, 9.5, 8.8],
    ],
    openings: [
      ['door', 9.5, 4.1, { hinge: 'end' }],
      ['passage', 6, 4.1],
      ['passage', 7.75, 3.2],
      ['door', 3.2, 5, { swing: 'back' }],
      ['door', 6.8, 5, { swing: 'back', hinge: 'end' }],
      ['door', 8.5, 5, { swing: 'back' }],
      ['door', 8.5, 7.4],
      ['slider', 3, 0],
      ['window', 7.75, 0],
      ['window', 2, 8.8, { double: true }],
      ['window', 5.75, 8.8, { double: true }],
    ],
  },
  house: {
    rooms: [
      ['living', 0, 0, 7, 5.5],
      ['kitchen', 7, 0, 11, 4],
      ['office', 11, 0, 14, 4],
      ['entrance', 7, 4, 14, 5.5],
      ['bedroom', 0, 5.5, 4, 9],
      ['bedroom', 4, 5.5, 7.5, 9],
      ['bathroom', 7.5, 5.5, 9.5, 9],
      ['toilet', 9.5, 5.5, 11, 7],
      ['garage', 11, 5.5, 14, 9],
    ],
    openings: [
      ['door', 14, 4.75, { hinge: 'end' }],
      ['passage', 7, 4.75],
      ['passage', 9, 4],
      ['door', 12.5, 4, { swing: 'back' }],
      ['door', 12.5, 5.5],
      ['door', 3.2, 5.5, { swing: 'back' }],
      ['door', 6.4, 5.5, { swing: 'back', hinge: 'end' }],
      ['door', 8.5, 5.5, { swing: 'back' }],
      ['door', 10.25, 5.5, { swing: 'back' }],
      ['slider', 3.5, 0],
      ['window', 9, 0],
      ['window', 12.5, 0],
      ['window', 2, 9, { double: true }],
      ['window', 5.75, 9, { double: true }],
      ['slider', 12.5, 9],
    ],
  },
};

export const TEMPLATES: TemplateId[] = ['studio', 't2', 't3', 'house'];

/** Le plan d'un modèle, prêt à être modifié. */
export function templatePlan(id: TemplateId, base: PlanDoc = emptyPlan()): PlanDoc {
  const spec = SPECS[id];
  const plan: PlanDoc = { ...base, nodes: [], walls: [], rooms: [], openings: [] };
  for (const [, x0, y0, x1, y1] of spec.rooms) addRect(plan, x0, y0, x1, y1);
  plan.rooms = spec.rooms.map(([type, x0, y0, x1, y1]) => ({
    id: newId('r'), name: t(ROOM_TYPES[type].label), floor: ROOM_TYPES[type].floor, floorMaterial: ROOM_TYPES[type].material,
    seed: { x: round3((x0 + x1) / 2), y: round3((y0 + y1) / 2) },
  }));
  reconcileRooms(plan, () => t('planRoom'), () => '#d8c3a5');
  for (const [kind, x, y, extra] of spec.openings) {
    const hit = wallAt(plan, { x, y }, 0.05);
    if (!hit) continue;
    const def = OPENING_DEFAULTS[kind];
    plan.openings.push({
      id: newId('o'), kind, wall: hit.wall.id, offset: round3(hit.offset), ...def,
      hinge: 'start', swing: 'front', ...extra,
      ...(kind === 'window' && extra?.double ? { width: 1.4 } : {}),
    });
  }
  return plan;
}
