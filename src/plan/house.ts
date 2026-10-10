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
import { hipRoof, planOutline, offset } from './roof';

export const ROOF_NAME = 'plan_roof';
/** Les couvertures proposées : tuile, ardoise, zinc. */
export const ROOF_COLORS = { tile: '#8f4a36', slate: '#4a5059', zinc: '#8e979e' } as const;
/** Pente du toit : 35°. */
const ROOF_SLOPE = Math.tan((35 * Math.PI) / 180);
/** Débord du toit au-delà des façades. */
const ROOF_EAVE = 0.3;

/**
 * Le toit en pente d'un niveau, posé sur ses murs (repère du niveau). Il
 * déborde un peu des façades et descend d'autant : le pan touche le haut des
 * murs pile au nu de la façade.
 */
export function buildRoof(doc: PlanDoc, color = '#8f4a36'): THREE.Group | null {
  const outline = planOutline(doc);
  if (outline.length < 3) return null;
  const base = (doc.wallHeight ?? 2.5) - ROOF_EAVE * ROOF_SLOPE;
  const eave = offset(outline, ROOF_EAVE);
  const strips = hipRoof(eave, ROOF_SLOPE);
  if (!strips.length) return null;
  // Garde-fou : les pans doivent couvrir le contour, ni plus ni moins. Sinon
  // (un contour que le calcul ne sait pas traiter), pas de toit plutôt que des pics.
  const shoelace = (p: Pt[]) => Math.abs(p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + (q.x * r.y - r.x * q.y) / 2; }, 0));
  const covered = strips.reduce((s, x) => s + shoelace(x.pts), 0);
  if (Math.abs(covered - shoelace(eave)) > 0.01 * shoelace(eave)) {
    console.warn('[Owlnest] roof skipped: outline not handled');
    return null;
  }
  const pos: number[] = [];
  const col: number[] = [];
  const tint = new THREE.Color(color);
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) return;
    // Chaque pan regarde le ciel.
    const [p, q, r] = n.y >= 0 ? [a, b, c] : [a, c, b];
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    // Une nuance par orientation : deux pans voisins ne se confondent jamais,
    // même sous un soleil qui les éclaire pareil.
    if (n.y < 0) n.negate();
    const h = Math.hypot(n.x, n.z) || 1;
    const k = 0.86 + 0.14 * ((n.x * 0.6 + n.z * 0.8) / h);
    for (let i = 0; i < 3; i++) col.push(k, k, k);
  };
  for (const s of strips) {
    const [a, b, c, d] = s.pts;
    const v = (p: Pt, h: number) => new THREE.Vector3(p.x, base + h, p.y);
    const A = v(a, s.h0), B = v(b, s.h0), C = v(c, s.h1), D = v(d, s.h1);
    tri(A, B, C);
    tri(A, C, D);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: tint, vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat);
  m.name = `${ROOF_NAME}_mesh`;
  m.castShadow = true;
  m.receiveShadow = true;
  const g = new THREE.Group();
  g.name = ROOF_NAME;
  // Hors de la fusion des objets immobiles : la carte le montre ou le cache seul.
  g.userData.owlnestLive = true;
  g.add(m);
  // Un trait sur les arêtes : sous un soleil qui éclaire deux pans pareil,
  // la forme du toit se lit quand même.
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 8),
    new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) }),
  );
  edges.name = `${ROOF_NAME}_edges`;
  edges.raycast = () => {};
  g.add(edges);
  return g;
}

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
    const m = new THREE.Mesh(prism(foot, y0, facade ? Math.max(top, y1 + 0.004) : y1), facade ? wallMat : slabMat);
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
    // La façade est celle de la maison : un étage la reprend, sauf la sienne.
    const g = buildPlan({ ...v.doc, outside: v.doc.outside ?? plan.outside, facade: v.doc.facade ?? plan.facade, plinth: false });
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
  // Un rez-de-chaussée vide (effacé, les étages gardés) : on centre sur ce qui existe.
  if (groundBox.isEmpty()) groundBox.setFromObject(root);
  return { root, groundBox };
}

/** Le groupe d'un niveau dans la maison construite (le rez-de-chaussée : la maison elle-même). */
export function floorGroup(root: THREE.Object3D, plan: PlanDoc, index: number): THREE.Object3D | null {
  if (index <= 0) return root;
  const v = floorViews(plan)[index];
  return v ? root.getObjectByName(`${FLOOR_PREFIX}${v.id}`) ?? null : null;
}
