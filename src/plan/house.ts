/**
 * La maison entière : le rez-de-chaussée, et les étages jusqu'à celui qu'on
 * regarde. Les étages du dessus ne sont pas construits : on voit dans l'étage
 * montré comme dans une maison de plain-pied.
 *
 * Un niveau sous l'étage montré est fermé par sa dalle : là où l'étage est
 * plus petit, on voit un toit plat, pas des pièces à ciel ouvert. Et le sol
 * d'un étage a l'épaisseur d'une dalle : un balcon a l'air porté.
 *
 * Seul l'étage montré garde le marquage des murs bas (voir low-walls.ts) :
 * les murs des niveaux du dessous restent entiers, et le marquage d'un niveau
 * désignerait à tort les murs d'un autre (les numéros de mur sont propres à
 * chaque plan).
 */
import * as THREE from 'three';
import type { PlanDoc } from './types';
import { buildPlan, prism } from './build';
import { floorViews, SLAB } from './floors';
import { WALL_ATTR } from './low-walls';
import { faces, isBoundary } from './graph';
import { wallFootprints } from './footprint';

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

const slabMaterial = () => new THREE.MeshStandardMaterial({ color: 0x9c988f, roughness: 0.95, metalness: 0 });

function slabMesh(name: string, geos: THREE.BufferGeometry[], mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  geos.forEach((geo, i) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = `${name}_${i}`;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  });
  return g;
}

/**
 * La dalle qui ferme un niveau par-dessus : ses pièces et ses murs, du haut
 * des murs jusque sous le sol du niveau suivant (`top`, en hauteur locale).
 */
function roofSlab(doc: PlanDoc, top: number, id: string): THREE.Group | null {
  const y0 = doc.wallHeight ?? 2.5;
  // Un peu sous le sol de l'étage, pour que les deux surfaces ne se battent pas.
  const y1 = Math.max(top - 0.025, y0 + 0.05);
  const polys = faces(doc).map((f) => f.poly);
  const feet = wallFootprints(doc);
  for (const w of doc.walls) {
    const foot = feet.get(w.id);
    if (foot && foot.length >= 3 && !isBoundary(doc, w)) polys.push(foot);
  }
  if (!polys.length) return null;
  return slabMesh(`plan_slab_${id}`, polys.map((p) => prism(p, y0, y1)), slabMaterial());
}

/** L'épaisseur sous les sols d'un étage. */
function underSlab(doc: PlanDoc, id: string): THREE.Group | null {
  const polys = faces(doc).map((f) => f.poly);
  if (!polys.length) return null;
  return slabMesh(`plan_under_${id}`, polys.map((p) => prism(p, -SLAB + 0.005, -0.02)), slabMaterial());
}

/** Construit le rez-de-chaussée et les étages jusqu'à `active` (0 : le rez-de-chaussée seul). */
export function buildHouse(plan: PlanDoc, active: number): BuiltHouse {
  const root = buildPlan(plan);
  root.updateMatrixWorld(true);
  const groundBox = new THREE.Box3().setFromObject(root);
  const views = floorViews(plan);
  const top = Math.min(Math.max(active, 0), views.length - 1);
  if (top > 0) stripWallTags(root);
  const groups: THREE.Object3D[] = [root];
  for (const v of views.slice(1, top + 1)) {
    const g = buildPlan(v.doc);
    g.name = `${FLOOR_PREFIX}${v.id}`;
    g.position.y = v.elevation;
    g.userData.owlnestFloor = v.index;
    if (v.index < top) stripWallTags(g);
    const under = underSlab(v.doc, v.id);
    if (under) g.add(under);
    root.add(g);
    groups.push(g);
  }
  // Chaque niveau sous l'étage montré reçoit sa dalle, jusqu'au sol du suivant.
  for (let k = 0; k < top; k++) {
    const slab = roofSlab(views[k].doc, views[k + 1].elevation - views[k].elevation, views[k].id);
    if (slab) groups[k].add(slab);
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
