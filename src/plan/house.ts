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
import { PLAN_COLORS } from './types';
import { buildPlan, prism } from './build';
import { floorViews, SLAB } from './floors';
import { WALL_ATTR } from './low-walls';
import { faces, isBoundary, wallEnds, wallLength, thicknessOf } from './graph';
import { wallFootprints } from './footprint';
import { type Pt, add, mul, norm, perp, sub, clipAlong, pointInPolygon } from './geometry';

/** Hauteur du muret qui borde un toit plat (l'acrotère). */
export const PARAPET = 0.35;

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

/** L'emprise d'un niveau au sol : ses pièces et ses murs. */
function footprintOf(doc: PlanDoc): Pt[][] {
  const polys = faces(doc).map((f) => f.poly);
  const feet = wallFootprints(doc);
  for (const w of doc.walls) {
    const foot = feet.get(w.id);
    if (foot && foot.length >= 3 && !isBoundary(doc, w)) polys.push(foot);
  }
  return polys;
}

/**
 * Le muret autour d'un toit plat : sur les murs de façade du niveau, là où
 * l'étage du dessus ne se pose pas (`above` : son emprise). Sans lui, un toit
 * plat ressemble à une boîte coupée.
 */
/** Un mur de façade : une pièce d'un seul côté. */
function isFacade(doc: PlanDoc, rooms: Pt[][], w: PlanDoc['walls'][number]): boolean {
  const [a, b] = wallEnds(doc, w);
  const dir = norm(sub(b, a)), n = perp(dir);
  const off = thicknessOf(doc, w) / 2 + 0.05;
  const mid = add(a, mul(dir, wallLength(doc, w) / 2));
  const inside = (p: Pt) => rooms.some((r) => pointInPolygon(p, r));
  return inside(add(mid, mul(n, off))) !== inside(sub(mid, mul(n, off)));
}

function parapets(doc: PlanDoc, above: Pt[][], y0: number): THREE.BufferGeometry[] {
  const rooms = faces(doc).map((f) => f.poly);
  const covered = (p: Pt) => above.some((r) => pointInPolygon(p, r));
  const feet = wallFootprints(doc);
  const out: THREE.BufferGeometry[] = [];
  const STEP = 0.1;
  for (const w of doc.walls) {
    const foot = feet.get(w.id);
    if (!foot || foot.length < 3 || isBoundary(doc, w)) continue;
    const [a, b] = wallEnds(doc, w);
    const L = wallLength(doc, w);
    if (L < 1e-3) continue;
    const dir = norm(sub(b, a));
    if (!isFacade(doc, rooms, w)) continue;
    // Les tronçons hors de l'étage du dessus, le long du mur.
    const steps = Math.max(1, Math.ceil(L / STEP));
    let start: number | null = null;
    for (let i = 0; i <= steps; i++) {
      const u = (i / steps) * L;
      const free = i < steps && !covered(add(a, mul(dir, Math.min(u + L / steps / 2, L))));
      if (free && start === null) start = u;
      if (!free && start !== null) {
        // Aux bouts du mur, le tronçon garde ses coins (onglets des angles).
        const piece = clipAlong(foot, a, dir, start <= 0 ? -1e3 : start, u >= L ? 1e3 : u);
        if (piece.length >= 3) out.push(prism(piece, y0, y0 + PARAPET));
        start = null;
      }
    }
  }
  return out;
}

/**
 * La dalle qui ferme un niveau par-dessus : ses pièces et ses murs, du haut
 * des murs jusque sous le sol du niveau suivant (`top`, en hauteur locale),
 * bordée d'un muret là où l'étage ne la couvre pas.
 */
function roofSlab(doc: PlanDoc, top: number, id: string, above: Pt[][]): THREE.Group | null {
  const y0 = doc.wallHeight ?? 2.5;
  // Un peu sous le sol de l'étage, pour que les deux surfaces ne se battent pas.
  const y1 = Math.max(top - 0.025, y0 + 0.05);
  const polys = faces(doc).map((f) => f.poly);
  if (!polys.length) return null;
  // Le dessus du toit en gris ; au-dessus des murs, la façade continue
  // jusqu'au muret, sans bande de dalle entre les deux.
  const g = slabMesh(`plan_slab_${id}`, polys.map((p) => prism(p, y0, y1)), slabMaterial());
  const wallMat = new THREE.MeshStandardMaterial({ color: doc.outside ?? PLAN_COLORS.outside, roughness: 0.9, metalness: 0 });
  const feet = wallFootprints(doc);
  const slabMat = (g.children[0] as THREE.Mesh).material as THREE.Material;
  doc.walls.forEach((w, i) => {
    const foot = feet.get(w.id);
    if (!foot || foot.length < 3 || isBoundary(doc, w)) return;
    // Façade : à peine plus haute que le toit, les deux dessus ne se battent
    // pas. Mur intérieur : du toit, au même niveau.
    const facade = isFacade(doc, polys, w);
    const m = new THREE.Mesh(prism(foot, y0, facade ? y1 + 0.004 : y1), facade ? wallMat : slabMat);
    m.name = `plan_slab_${id}_wall_${i}`;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  });
  parapets(doc, above, y1).forEach((geo, i) => {
    const m = new THREE.Mesh(geo, wallMat);
    m.name = `plan_parapet_${id}_${i}`;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  });
  return g;
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
    const slab = roofSlab(views[k].doc, views[k + 1].elevation - views[k].elevation, views[k].id, footprintOf(views[k + 1].doc));
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
