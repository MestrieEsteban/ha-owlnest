/**
 * plan/templates.ts — des logements tout prêts, pour ne pas partir d'une page
 * blanche : on choisit le plus proche du sien, puis on pousse les murs.
 */

import { t } from '../i18n';
import type { PlanDoc, OpeningKind, PlanItem } from './types';
import { emptyPlan, OPENING_DEFAULTS } from './types';
import { addRect, wallAt, reconcileRooms, newId } from './graph';
import { round3 } from './geometry';
import { ROOM_TYPES, type RoomType } from './rooms';

export type TemplateId = 'studio' | 't2' | 't3' | 'house';

/** Un mur de la pièce : nord (haut du plan), sud, est, ouest. */
type Side = 'n' | 's' | 'e' | 'w';

/**
 * Un meuble d'un modèle de logement, décrit par rapport à sa pièce. Sa
 * position exacte se calcule avec ses vraies dimensions : un meuble « contre
 * le mur » y touche, quelle que soit sa profondeur.
 *
 * Les distances sont en mètres depuis le coin nord-ouest de la pièce.
 */
type Spot =
  /** Contre un mur, l'avant vers la pièce, centré à `at` le long du mur (ou calé à un bout). `turn` : le long côté contre le mur. */
  | { m: string; side: Side; at: number | 'start' | 'end'; turn?: boolean }
  /** Une rangée de meubles collés les uns aux autres, depuis un bout du mur. */
  | { run: Side; from: 'start' | 'end'; ms: string[] }
  /** Posé librement ; `rot` en degrés, sens horaire vu de dessus (0 : l'avant vers le sud). */
  | { m: string; x: number; y: number; rot: number }
  /** Posé sur le meuble n° `on` de la pièce (lampe de chevet, télévision). */
  | { m: string; on: number }
  /** Contre le même mur que le meuble n° `beside`, juste à côté, du côté `end`. */
  | { m: string; beside: number; end: 1 | -1 }
  /** À côté du meuble n° `by`, décalé de (`dx`, `dy`) : une chaise autour d'une table. */
  | { m: string; by: number; dx: number; dy: number; rot: number };

/** Emprise d'un meuble vue de dessus, avant toute rotation. */
export type SizeOf = (model: string) => { w: number; d: number } | null;

interface Spec {
  rooms: [RoomType, number, number, number, number, Spot[]?][];
  openings: [OpeningKind, number, number, Partial<{ hinge: 'start' | 'end'; swing: 'front' | 'back'; double: boolean }>?][];
}

const SPECS: Record<TemplateId, Spec> = {
  studio: {
    rooms: [
      ['living', 0, 0, 5, 4.5, [
        { run: 'n', from: 'start', ms: ['kitchenFridge', 'kitchenCabinet', 'kitchenSink', 'kitchenStove'] },
        { m: 'q_Bed_King', side: 's', at: 2.6 },
        { m: 'q_NightStand_1', beside: 4, end: -1 },
        { m: 'q_NightStand_1', beside: 4, end: 1 },
        { m: 'lampRoundTable', on: 5 },
        { m: 'q_Couch_Small1', side: 'w', at: 1.8 },
        { m: 'q_Table_RoundSmall', x: 4.15, y: 1.75, rot: 0 },
        { m: 'q_Chair_1', by: 9, dx: 0, dy: -0.9, rot: 0 },
        { m: 'q_Chair_1', by: 9, dx: 0, dy: 0.9, rot: 180 },
      ]],
      ['bathroom', 5, 0, 7.2, 2.2, [
        { run: 'n', from: 'end', ms: ['q_Bathroom_Shower1'] },
        { m: 'q_Bathroom_Toilet', side: 'w', at: 0.5 },
        { m: 'q_Bathroom_Sink', side: 'w', at: 1.5 },
      ]],
      ['entrance', 5, 2.2, 7.2, 4.5, [
        { m: 'coatRackStanding', side: 'e', at: 0.8 },
        { m: 'rugDoormat', side: 's', at: 1.1 },
      ]],
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
      ['living', 0, 0, 5.5, 5, [
        { m: 'cabinetTelevision', side: 'w', at: 2.5 },
        { m: 'televisionModern', on: 0 },
        { m: 'rugRectangle', x: 2.6, y: 2.5, rot: 90 },
        { m: 'q_Couch_Medium1', x: 3.6, y: 2.5, rot: 90 },
        { m: 'tableCoffee', x: 2.3, y: 2.5, rot: 90 },
        { m: 'lampRoundFloor', x: 3.6, y: 0.95, rot: 90 },
        { run: 'n', from: 'end', ms: ['pottedPlant'] },
      ]],
      ['kitchen', 5.5, 0, 8.5, 3, [
        { run: 'n', from: 'start', ms: ['kitchenFridge', 'kitchenSink', 'kitchenStove'] },
      ]],
      ['entrance', 5.5, 3, 8.5, 5, [
        { m: 'coatRackStanding', side: 's', at: 0.5 },
        { m: 'rugDoormat', side: 'e', at: 1 },
      ]],
      ['bedroom', 0, 5, 4.5, 8.5, [
        { m: 'q_Bed_King', side: 'w', at: 1.75 },
        { m: 'q_NightStand_1', beside: 0, end: -1 },
        { m: 'q_NightStand_1', beside: 0, end: 1 },
        { m: 'lampRoundTable', on: 1 },
        { m: 'lampRoundTable', on: 2 },
        { m: 'q_Drawer_1', side: 'e', at: 2.3 },
      ]],
      ['bathroom', 4.5, 5, 7, 8.5, [
        { m: 'q_Bathroom_Bathtub', side: 'e', at: 'end', turn: true },
        { m: 'q_Bathroom_Sink', side: 'w', at: 1.6 },
        { m: 'q_Bathroom_WashingMachine', side: 'w', at: 2.7 },
      ]],
      ['toilet', 7, 5, 8.5, 6.6, [
        { m: 'q_Bathroom_Toilet2', side: 'e', at: 1.2 },
      ]],
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
      ['living', 0, 0, 6, 5, [
        { m: 'cabinetTelevision', side: 'w', at: 2.5 },
        { m: 'televisionModern', on: 0 },
        { m: 'rugRectangle', x: 2.8, y: 2.5, rot: 90 },
        { m: 'q_Couch_Medium1', x: 3.9, y: 2.5, rot: 90 },
        { m: 'tableCoffee', x: 2.5, y: 2.5, rot: 90 },
        { m: 'lampRoundFloor', x: 3.9, y: 0.95, rot: 90 },
        { run: 'n', from: 'end', ms: ['pottedPlant'] },
      ]],
      ['kitchen', 6, 0, 9.5, 3.2, [
        { run: 'n', from: 'start', ms: ['kitchenFridge', 'kitchenCabinet', 'kitchenSink'] },
        { m: 'kitchenStove', side: 'e', at: 1.5 },
        { m: 'q_Table_RoundSmall', x: 1.2, y: 2.2, rot: 0 },
        { m: 'q_Chair_1', by: 4, dx: -0.9, dy: 0, rot: -90 },
        { m: 'q_Chair_1', by: 4, dx: 0.9, dy: 0, rot: 90 },
      ]],
      ['entrance', 6, 3.2, 9.5, 5, [
        { m: 'coatRackStanding', side: 's', at: 1.6 },
        { m: 'rugDoormat', side: 'e', at: 0.9 },
      ]],
      ['bedroom', 0, 5, 4, 8.8, [
        { m: 'q_Bed_King', side: 'w', at: 1.9 },
        { m: 'q_NightStand_1', beside: 0, end: -1 },
        { m: 'q_NightStand_1', beside: 0, end: 1 },
        { m: 'lampRoundTable', on: 1 },
        { m: 'lampRoundTable', on: 2 },
        { m: 'q_Drawer_1', side: 'e', at: 2.6 },
      ]],
      ['bedroom', 4, 5, 7.5, 8.8, [
        { m: 'q_Bed_Single', side: 'w', at: 2.2 },
        { m: 'q_NightStand_1', beside: 0, end: -1 },
        { m: 'desk', side: 'e', at: 3 },
        { m: 'chairDesk', by: 2, dx: -0.55, dy: 0, rot: -90 },
        { m: 'computerScreen', on: 2 },
      ]],
      ['bathroom', 7.5, 5, 9.5, 7.4, [
        { m: 'q_Bathroom_Sink', side: 'e', at: 1.2 },
        { m: 'q_Bathroom_Shower1', side: 'w', at: 'end' },
      ]],
      ['toilet', 7.5, 7.4, 9.5, 8.8, [
        { m: 'q_Bathroom_Toilet2', side: 'w', at: 0.7 },
      ]],
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
      ['living', 0, 0, 7, 5.5, [
        { m: 'cabinetTelevision', side: 'w', at: 2.6 },
        { m: 'televisionModern', on: 0 },
        { m: 'rugRectangle', x: 3.2, y: 2.6, rot: 90 },
        { m: 'q_Couch_Medium1', x: 4.3, y: 2.6, rot: 90 },
        { m: 'tableCoffee', x: 2.9, y: 2.6, rot: 90 },
        { m: 'lampRoundFloor', x: 4.3, y: 1, rot: 90 },
        { m: 'q_Bookshelf', side: 'n', at: 5.8 },
        { run: 'n', from: 'start', ms: ['pottedPlant'] },
      ]],
      ['kitchen', 7, 0, 11, 4, [
        { run: 'n', from: 'start', ms: ['kitchenFridge', 'kitchenCabinet', 'kitchenSink', 'kitchenStove'] },
        { m: 'q_Table_RoundSmall', x: 2, y: 2.4, rot: 0 },
        { m: 'q_Chair_1', by: 4, dx: 0, dy: -0.9, rot: 0 },
        { m: 'q_Chair_1', by: 4, dx: 0, dy: 0.9, rot: 180 },
        { m: 'q_Chair_1', by: 4, dx: -0.9, dy: 0, rot: -90 },
        { m: 'q_Chair_1', by: 4, dx: 0.9, dy: 0, rot: 90 },
      ]],
      ['office', 11, 0, 14, 4, [
        { m: 'desk', side: 'w', at: 1.6 },
        { m: 'chairDesk', by: 0, dx: 0.55, dy: 0, rot: 90 },
        { m: 'computerScreen', on: 0 },
        { m: 'q_Bookshelf', side: 'e', at: 1.8 },
      ]],
      ['entrance', 7, 4, 14, 5.5, [
        { m: 'coatRackStanding', side: 'n', at: 0.6 },
        { m: 'rugDoormat', side: 'e', at: 0.75 },
      ]],
      ['bedroom', 0, 5.5, 4, 9, [
        { m: 'q_Bed_King', side: 'w', at: 1.75 },
        { m: 'q_NightStand_1', beside: 0, end: -1 },
        { m: 'q_NightStand_1', beside: 0, end: 1 },
        { m: 'lampRoundTable', on: 1 },
        { m: 'lampRoundTable', on: 2 },
        { m: 'q_Drawer_1', side: 'e', at: 2.3 },
      ]],
      ['bedroom', 4, 5.5, 7.5, 9, [
        { m: 'q_Bed_Single', side: 'w', at: 2.1 },
        { m: 'q_NightStand_1', beside: 0, end: -1 },
        { m: 'q_Drawer_4', side: 'e', at: 2.6 },
      ]],
      ['bathroom', 7.5, 5.5, 9.5, 9, [
        { m: 'q_Bathroom_Bathtub', side: 'e', at: 'end', turn: true },
        { m: 'q_Bathroom_Sink', side: 'w', at: 1.5 },
        { m: 'q_Bathroom_WashingMachine', side: 'w', at: 2.6 },
      ]],
      ['toilet', 9.5, 5.5, 11, 7, [
        { m: 'q_Bathroom_Toilet2', side: 'e', at: 1.1 },
      ]],
      ['garage', 11, 5.5, 14, 9, [
        { m: 'q_Shelf_Large', side: 'e', at: 1.75 },
      ]],
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

/** Les meubles d'un modèle, pour les charger avant de le poser. */
export function templateModels(id: TemplateId): string[] {
  const out = new Set<string>();
  for (const [, , , , , spots] of SPECS[id].rooms) {
    for (const s of spots ?? []) {
      if ('ms' in s) s.ms.forEach((m) => out.add(m));
      else out.add(s.m);
    }
  }
  return [...out];
}

/** L'avant d'un meuble contre ce mur regarde la pièce (même convention que l'aimant). */
const FACING: Record<Side, number> = { n: 0, s: 180, w: -90, e: 90 };

/**
 * Les meubles d'une pièce rectangulaire, posés d'après leurs vraies
 * dimensions. `inset` : demi-épaisseur des murs, la face intérieure.
 */
function furnish(spots: Spot[], x0: number, y0: number, x1: number, y1: number, inset: number, sizeOf: SizeOf): PlanItem[] {
  const out: (PlanItem & { side?: Side; along?: number; span?: number })[] = [];
  const dims = (m: string) => sizeOf(m) ?? { w: 0.6, d: 0.6 };
  const horiz = (side: Side) => side === 'n' || side === 's';
  // Le long d'un mur : d'un coin à l'autre, faces intérieures comprises.
  const lo = (side: Side) => (horiz(side) ? x0 : y0) + inset;
  const hi = (side: Side) => (horiz(side) ? x1 : y1) - inset;
  const place = (m: string, side: Side, center: number, turn = false) => {
    const { w, d } = dims(m);
    const along = turn ? d : w, depth = turn ? w : d;
    const c = Math.min(Math.max(center, lo(side) + along / 2), hi(side) - along / 2);
    const off = inset + depth / 2 + 0.005;
    const pos = side === 'n' ? { x: c, y: y0 + off } : side === 's' ? { x: c, y: y1 - off }
      : side === 'w' ? { x: x0 + off, y: c } : { x: x1 - off, y: c };
    out.push({ id: newId('i'), model: m, x: round3(pos.x), y: round3(pos.y), rotation: FACING[side] + (turn ? 90 : 0), side, along: c, span: along });
  };
  for (const s of spots) {
    if ('run' in s) {
      let cursor = s.from === 'start' ? lo(s.run) : hi(s.run);
      for (const m of s.ms) {
        const w = dims(m).w;
        place(m, s.run, s.from === 'start' ? cursor + w / 2 : cursor - w / 2);
        cursor += s.from === 'start' ? w : -w;
      }
    } else if ('side' in s) {
      const span = s.turn ? dims(s.m).d : dims(s.m).w;
      const at = s.at === 'start' ? lo(s.side) + span / 2 : s.at === 'end' ? hi(s.side) - span / 2 : (horiz(s.side) ? x0 : y0) + s.at;
      place(s.m, s.side, at, s.turn);
    } else if ('beside' in s) {
      const host = out[s.beside];
      if (!host?.side) continue;
      const { w } = dims(s.m);
      place(s.m, host.side, host.along! + s.end * (host.span! / 2 + w / 2 + 0.02));
    } else if ('on' in s) {
      const host = out[s.on];
      if (host) out.push({ id: newId('i'), model: s.m, x: host.x, y: host.y, rotation: host.rotation });
    } else if ('by' in s) {
      const host = out[s.by];
      if (host) out.push({ id: newId('i'), model: s.m, x: round3(host.x + s.dx), y: round3(host.y + s.dy), rotation: s.rot });
    } else {
      out.push({ id: newId('i'), model: s.m, x: round3(x0 + s.x), y: round3(y0 + s.y), rotation: s.rot });
    }
  }
  return out.map(({ side: _s, along: _a, span: _p, ...it }) => it);
}

/**
 * Le plan d'un modèle, prêt à être modifié. `sizeOf` donne les dimensions
 * réelles des meubles ; sans elle, les pièces arrivent vides.
 */
export function templatePlan(id: TemplateId, base: PlanDoc = emptyPlan(), sizeOf?: SizeOf): PlanDoc {
  const spec = SPECS[id];
  const plan: PlanDoc = { ...base, nodes: [], walls: [], rooms: [], openings: [], items: [] };
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
  if (sizeOf) {
    const inset = plan.wallThickness / 2;
    plan.items = spec.rooms.flatMap(([, x0, y0, x1, y1, spots]) => furnish(spots ?? [], x0, y0, x1, y1, inset, sizeOf));
  }
  return plan;
}
