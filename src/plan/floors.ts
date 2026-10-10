/**
 * Les étages d'un logement.
 *
 * Le plan d'origine reste le rez-de-chaussée : tout le code qui travaille sur
 * un plan continue de le faire, et un plan enregistré avant les étages n'a rien
 * à convertir. Les étages s'ajoutent dans `floors`, chacun avec son propre
 * plan et sa hauteur au-dessus du rez-de-chaussée.
 *
 * Tous les étages partagent l'origine du rez-de-chaussée : un mur de l'étage
 * dessiné au-dessus d'un mur du bas tombe pile dessus dans la 3D.
 */
import type { PlanDoc, PlanFloor } from './types';
import { newId } from './graph';

/** Épaisseur de dalle entre deux étages, en mètres. */
export const SLAB = 0.2;

export interface FloorView {
  /** 0 : rez-de-chaussée. */
  index: number;
  id: string;
  name: string;
  /** Hauteur du sol au-dessus de celui du rez-de-chaussée, en mètres. */
  elevation: number;
  doc: PlanDoc;
}

/** Le plan d'un étage, sans la liste des étages (seul le rez-de-chaussée la porte). */
function bare(doc: PlanDoc): PlanDoc {
  const { floors: _f, groundName: _g, ...rest } = doc;
  return rest as PlanDoc;
}

/** Tous les niveaux, du rez-de-chaussée vers le haut. */
export function floorViews(plan: PlanDoc, groundLabel = 'RDC'): FloorView[] {
  const out: FloorView[] = [{ index: 0, id: 'ground', name: plan.groundName || groundLabel, elevation: 0, doc: plan }];
  const ups = [...(plan.floors ?? [])].sort((a, b) => a.elevation - b.elevation);
  ups.forEach((f, i) => out.push({ index: i + 1, id: f.id, name: f.name, elevation: f.elevation, doc: f.doc }));
  return out;
}

/** Le plan du niveau `index` (le rez-de-chaussée garde ses étages). */
export function floorDoc(plan: PlanDoc, index: number): PlanDoc {
  return floorViews(plan)[index]?.doc ?? plan;
}

/**
 * Le logement, avec le plan du niveau `index` remplacé par `doc`. Si la
 * hauteur des murs de ce niveau change, les étages du dessus montent ou
 * descendent d'autant : ils restent posés sur lui.
 */
export function withFloorDoc(plan: PlanDoc, index: number, doc: PlanDoc): PlanDoc {
  const views = floorViews(plan);
  const target = views[index];
  if (!target) return plan;
  const delta = Math.round(((doc.wallHeight ?? 2.5) - (target.doc.wallHeight ?? 2.5)) * 1000) / 1000;
  const shift = (f: PlanFloor): PlanFloor => (delta && f.elevation > target.elevation
    ? { ...f, elevation: Math.round((f.elevation + delta) * 1000) / 1000 } : f);
  if (index === 0) return { ...bare(doc), floors: plan.floors?.map(shift), groundName: plan.groundName };
  return { ...plan, floors: (plan.floors ?? []).map((f) => shift(f.id === target.id ? { ...f, doc: bare(doc) } : f)) };
}

/**
 * Un étage de plus, au-dessus du dernier. Il reprend les murs et les pièces du
 * niveau du dessous (avec de nouveaux identifiants) : on n'a plus qu'à retirer
 * ou déplacer ce qui change. Portes, fenêtres et meubles ne sont pas repris.
 */
export function addFloor(plan: PlanDoc, name: string): { plan: PlanDoc; index: number } {
  const views = floorViews(plan);
  const top = views[views.length - 1];
  const elevation = Math.round((top.elevation + (top.doc.wallHeight ?? 2.5) + SLAB) * 100) / 100;
  const nodeId = new Map(top.doc.nodes.map((n) => [n.id, newId('n')]));
  const doc: PlanDoc = {
    version: 2,
    wallHeight: top.doc.wallHeight,
    wallThickness: top.doc.wallThickness,
    nodes: top.doc.nodes.map((n) => ({ ...n, id: nodeId.get(n.id)! })),
    walls: top.doc.walls.map((w) => ({ ...w, id: newId('w'), a: nodeId.get(w.a) ?? w.a, b: nodeId.get(w.b) ?? w.b })),
    rooms: top.doc.rooms.map((r) => ({ ...r, id: newId('r') })),
    openings: [],
    items: [],
    ...(top.doc.outside ? { outside: top.doc.outside } : {}),
  };
  const floor: PlanFloor = { id: newId('f'), name, elevation, doc };
  return { plan: { ...plan, floors: [...(plan.floors ?? []), floor] }, index: views.length };
}

/** Retire un étage (jamais le rez-de-chaussée). */
export function removeFloor(plan: PlanDoc, index: number): PlanDoc {
  if (index <= 0) return plan;
  const target = floorViews(plan)[index];
  if (!target) return plan;
  const floors = (plan.floors ?? []).filter((f) => f.id !== target.id);
  return { ...plan, floors: floors.length ? floors : undefined };
}

/** Renomme un niveau. */
export function renameFloor(plan: PlanDoc, index: number, name: string): PlanDoc {
  if (index === 0) return { ...plan, groundName: name || undefined };
  const target = floorViews(plan)[index];
  if (!target) return plan;
  return { ...plan, floors: (plan.floors ?? []).map((f) => (f.id === target.id ? { ...f, name } : f)) };
}

/**
 * Le niveau d'une hauteur au-dessus du sol du rez-de-chaussée : le plus haut
 * dont le sol est en dessous (à 10 cm près, pour une pastille posée au sol).
 */
export function floorOfHeight(plan: PlanDoc, height: number): number {
  const views = floorViews(plan);
  let k = 0;
  for (const v of views) if (height >= v.elevation - 0.1) k = v.index;
  return k;
}

/**
 * Toutes les portes et fenêtres du logement, pour accorder les ouvrants : la
 * numérotation (« Porte 4 ») continue d'un étage à l'autre.
 */
export function allOpenings(plan: PlanDoc): PlanDoc {
  return { ...plan, openings: floorViews(plan).flatMap((v) => v.doc.openings) };
}

/** Le logement a-t-il des murs, à un niveau ou à un autre ? */
export function hasWalls(plan: PlanDoc): boolean {
  return floorViews(plan).some((v) => v.doc.walls.length > 0);
}
