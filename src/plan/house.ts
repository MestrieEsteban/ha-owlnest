/**
 * La maison entière : le rez-de-chaussée, et les étages jusqu'à celui qu'on
 * regarde. Les étages du dessus ne sont pas construits : on voit dans l'étage
 * montré comme dans une maison de plain-pied.
 *
 * Seul l'étage montré garde le marquage des murs bas (voir low-walls.ts) :
 * les murs des niveaux du dessous restent entiers, et le marquage d'un niveau
 * désignerait à tort les murs d'un autre (les numéros de mur sont propres à
 * chaque plan).
 */
import * as THREE from 'three';
import type { PlanDoc } from './types';
import { buildPlan } from './build';
import { floorViews } from './floors';
import { WALL_ATTR } from './low-walls';

export const FLOOR_PREFIX = 'plan_floor_';

/** Retire le marquage des murs bas d'un groupe (sans descendre dans les étages qu'il contient). */
function stripWallTags(group: THREE.Object3D) {
  const visit = (o: THREE.Object3D) => {
    if (o !== group && o.name.startsWith(FLOOR_PREFIX)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry?.getAttribute(WALL_ATTR)) mesh.geometry.deleteAttribute(WALL_ATTR);
    o.children.forEach(visit);
  };
  visit(group);
}

export interface BuiltHouse {
  root: THREE.Group;
  /**
   * La boîte du rez-de-chaussée seul : la carte centre la maison sur elle,
   * pour que monter d'un étage ne déplace pas ce qui est déjà posé.
   */
  groundBox: THREE.Box3;
}

/** Construit le rez-de-chaussée et les étages jusqu'à `active` (0 : le rez-de-chaussée seul). */
export function buildHouse(plan: PlanDoc, active: number): BuiltHouse {
  const root = buildPlan(plan);
  root.updateMatrixWorld(true);
  const groundBox = new THREE.Box3().setFromObject(root);
  const views = floorViews(plan);
  const top = Math.min(Math.max(active, 0), views.length - 1);
  if (top > 0) stripWallTags(root);
  for (const v of views.slice(1, top + 1)) {
    const g = buildPlan(v.doc);
    g.name = `${FLOOR_PREFIX}${v.id}`;
    g.position.y = v.elevation;
    g.userData.owlnestFloor = v.index;
    if (v.index < top) stripWallTags(g);
    root.add(g);
  }
  root.updateMatrixWorld(true);
  return { root, groundBox };
}

/** Le groupe d'un niveau dans la maison construite (le rez-de-chaussée : la maison elle-même). */
export function floorGroup(root: THREE.Object3D, plan: PlanDoc, index: number): THREE.Object3D | null {
  if (index <= 0) return root;
  const v = floorViews(plan)[index];
  return v ? root.getObjectByName(`${FLOOR_PREFIX}${v.id}`) ?? null : null;
}
