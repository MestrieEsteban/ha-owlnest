/**
 * plan/build.ts — la maison en 3D, construite à partir du plan.
 *
 * Murs, sols, portes et fenêtres sont fabriqués ici, à chaque chargement et à
 * chaque retouche. Les noms suivent les conventions déjà connues du reste de
 * la carte : `wall_…` et `room_…` comme un export Sweet Home 3D, et chaque
 * vantail porte, comme à l'import, ses informations d'ouvrant (`owlnestLeaf`).
 * Une porte dessinée est donc un ouvrant dès sa création.
 *
 * Chaque face de mur prend la couleur de la pièce qu'elle regarde (ou celle de
 * l'extérieur). Une face est un maillage à elle, d'une seule matière : les
 * maillages de même matière sont ensuite fusionnés par la carte (batching.ts),
 * ce qu'un maillage à plusieurs matières empêcherait.
 */

import * as THREE from 'three';
import type { PlanDoc, PlanOpening, PlanWall, PlanRoom } from './types';
import { PLAN_COLORS } from './types';
import { type Pt, sub, add, mul, dot, norm, perp, clipAlong, area, pointInPolygon } from './geometry';
import { wallEnds, heightOf, thicknessOf, openingFits, faces, wallLength, isBoundary, type Face } from './graph';
import { wallFootprints } from './footprint';
import { floorTexture, TEXTURE_METERS } from './textures';

/** Préfixe des vantaux construits depuis le plan : `plan_leaf_<ouverture>_<n>`. */
export const PLAN_LEAF = 'plan_leaf_';

export function leafName(openingId: string, n: number): string {
  return `${PLAN_LEAF}${openingId}_${n}`;
}

const FRAME = 0.05;   // largeur du cadre
const LEAF = 0.04;    // épaisseur d'un vantail

/** Matières partagées, une par teinte : autant de maillages fusionnables. */
class Palette {
  private mats = new Map<string, THREE.Material>();

  get(key: string, make: () => THREE.Material): THREE.Material {
    let m = this.mats.get(key);
    if (!m) { m = make(); this.mats.set(key, m); }
    return m;
  }

  paint(color: string, roughness = 0.9, metalness = 0) {
    return this.get(`paint:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  }

  glass() {
    return this.get('glass', () => new THREE.MeshStandardMaterial({
      color: '#bfe3f5', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false,
    }));
  }

  floor(room: PlanRoom) {
    const color = room.floor ?? '#c9b08a';
    const kind = room.floorMaterial ?? 'plain';
    return this.get(`floor:${color}:${kind}`, () => {
      const map = floorTexture(kind);
      return new THREE.MeshStandardMaterial({
        color, map, roughness: kind === 'tiles' ? 0.35 : kind === 'wood' ? 0.6 : 0.9,
      });
    });
  }
}

/**
 * Les faces d'un prisme droit : un contour vu de dessus (x, y du plan → x, z
 * de la scène), de `y0` à `y1`. `side(i)` dit à quel groupe appartient la face
 * verticale posée sur l'arête i ; le dessus et le dessous sont le groupe 0.
 * Le contour peut être concave (pièce en L).
 */
function prismFaces(poly: readonly Pt[], y0: number, y1: number, side: (p: Pt, q: Pt) => number = () => 0, uvMeters = 0) {
  const pts = area(poly) < 0 ? [...poly].reverse() : [...poly];
  const groups = new Map<number, { pos: number[]; uv: number[] }>();
  const bucket = (g: number) => {
    let b = groups.get(g);
    if (!b) { b = { pos: [], uv: [] }; groups.set(g, b); }
    return b;
  };
  const push = (b: { pos: number[]; uv: number[] }, p: Pt, y: number, u = p.x, v = p.y) => {
    b.pos.push(p.x, y, p.y);
    if (uvMeters) b.uv.push(u / uvMeters, v / uvMeters);
  };
  const caps = bucket(0);
  const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.x, p.y)), []);
  for (const [a, b, c] of tris) {
    // Dessus vers le haut, dessous vers le bas.
    push(caps, pts[a], y1); push(caps, pts[c], y1); push(caps, pts[b], y1);
    push(caps, pts[a], y0); push(caps, pts[b], y0); push(caps, pts[c], y0);
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const b = bucket(side(p, q));
    push(b, p, y0); push(b, p, y1); push(b, q, y1);
    push(b, p, y0); push(b, q, y1); push(b, q, y0);
  }
  const out = new Map<number, THREE.BufferGeometry>();
  for (const [g, b] of groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    if (uvMeters) geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.computeVertexNormals();
    out.set(g, geo);
  }
  return out;
}

/** Un prisme d'un seul tenant. */
export function prism(poly: readonly Pt[], y0: number, y1: number, uvMeters = 0): THREE.BufferGeometry {
  return [...prismFaces(poly, y0, y1, () => 0, uvMeters).values()][0];
}

function mesh(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** Un pavé dans le repère d'une ouverture : x le long du mur, y vers le haut, z à travers. */
function box(name: string, mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(Math.max(x1 - x0, 1e-4), Math.max(y1 - y0, 1e-4), Math.max(z1 - z0, 1e-4));
  const m = mesh(name, geo, mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return m;
}

/** La pièce qui touche un point, s'il y en a une. */
function roomAt(rooms: { room: PlanRoom; face: Face }[], p: Pt): PlanRoom | null {
  let best: { room: PlanRoom; face: Face } | null = null;
  for (const r of rooms) if (pointInPolygon(p, r.face.poly) && (!best || r.face.area < best.face.area)) best = r;
  return best?.room ?? null;
}

/**
 * Les blocs d'un mur : la semelle découpée le long du mur autour des
 * ouvertures (pleine hauteur entre elles, allège dessous, linteau dessus).
 * Ses deux grandes faces prennent la couleur de la pièce qu'elles regardent.
 */
function buildWall(
  plan: PlanDoc, w: PlanWall, foot: Pt[], index: number, pal: Palette, rooms: { room: PlanRoom; face: Face }[], group: THREE.Group,
) {
  const [a, b] = wallEnds(plan, w);
  const dir = norm(sub(b, a)), n = perp(dir);
  const H = heightOf(plan, w);
  const half = thicknessOf(plan, w) / 2;
  const mid = mul(add(a, b), 0.5);
  const probe = half + 0.1;
  const roomLeft = roomAt(rooms, add(mid, mul(n, probe)));
  const roomRight = roomAt(rooms, add(mid, mul(n, -probe)));
  const outside = plan.outside ?? PLAN_COLORS.outside;
  const left = roomLeft ? roomLeft.wall ?? PLAN_COLORS.wall : outside;
  const right = roomRight ? roomRight.wall ?? PLAN_COLORS.wall : outside;
  // Le dessus et les chants : la couleur d'une pièce plutôt que celle du dehors.
  const core = roomLeft || !roomRight ? left : right;
  const mats = [pal.paint(core, 0.92), pal.paint(left, 0.92), pal.paint(right, 0.92)];
  const side = (p: Pt, q: Pt) => {
    const s = dot(sub(mul(add(p, q), 0.5), a), n);
    return s > half * 0.5 ? 1 : s < -half * 0.5 ? 2 : 0;
  };

  const holes = plan.openings
    .filter((o) => o.wall === w.id && openingFits(plan, o))
    .map((o) => ({ u0: o.offset - o.width / 2, u1: o.offset + o.width / 2, sill: o.sill, top: Math.min(o.sill + o.height, H) }))
    .sort((p, q) => p.u0 - q.u0);

  const pieces: { u0: number; u1: number; y0: number; y1: number }[] = [];
  // Au-delà des extrémités, la semelle déborde en onglet : on la garde entière.
  let cursor = -1e3;
  for (const h of holes) {
    if (h.u0 > cursor) pieces.push({ u0: cursor, u1: h.u0, y0: 0, y1: H });
    if (h.sill > 1e-3) pieces.push({ u0: h.u0, u1: h.u1, y0: 0, y1: h.sill });
    if (h.top < H - 1e-3) pieces.push({ u0: h.u0, u1: h.u1, y0: h.top, y1: H });
    cursor = Math.max(cursor, h.u1);
  }
  pieces.push({ u0: cursor, u1: 1e3, y0: 0, y1: H });

  pieces.forEach((p, k) => {
    const poly = clipAlong(foot, a, dir, p.u0, p.u1);
    if (poly.length < 3 || Math.abs(area(poly)) < 1e-6) return;
    // Mêmes matières des deux côtés : un seul maillage.
    const split = left === right && left === core ? () => 0 : side;
    for (const [g, geo] of prismFaces(poly, p.y0, p.y1, split)) {
      group.add(mesh(`wall_${index}_${k}${g ? `_${g}` : ''}`, geo, mats[g]));
    }
  });
}

/** Un vantail vitré : un cadre de quatre barres et une vitre, et des petits bois au besoin. */
function glazedLeaf(
  leaf: THREE.Group, pal: Palette, frameMat: THREE.Material, x0: number, w: number, y0: number, h: number, z: number, bar: number, grid: boolean,
) {
  const n = leaf.name;
  const zz = [z - LEAF / 2, z + LEAF / 2] as const;
  leaf.add(box(`${n}_frame_l`, frameMat, x0, x0 + bar, y0, y0 + h, ...zz));
  leaf.add(box(`${n}_frame_r`, frameMat, x0 + w - bar, x0 + w, y0, y0 + h, ...zz));
  leaf.add(box(`${n}_frame_t`, frameMat, x0, x0 + w, y0 + h - bar, y0 + h, ...zz));
  leaf.add(box(`${n}_frame_b`, frameMat, x0, x0 + w, y0, y0 + bar, ...zz));
  const pane = box(`${n}_pane`, pal.glass(), x0 + bar, x0 + w - bar, y0 + bar, y0 + h - bar, z - 0.006, z + 0.006);
  pane.castShadow = false;
  leaf.add(pane);
  if (grid) {
    // Petits bois : une croix, deux barres horizontales sur une grande vitre.
    const t = 0.02, zg = [z - 0.012, z + 0.012] as const;
    const cx = x0 + w / 2;
    leaf.add(box(`${n}_muntin_v`, frameMat, cx - t / 2, cx + t / 2, y0 + bar, y0 + h - bar, ...zg));
    const rows = h > 1.6 ? 3 : 2;
    for (let i = 1; i < rows; i++) {
      const y = y0 + bar + ((h - 2 * bar) * i) / rows;
      leaf.add(box(`${n}_muntin_h${i}`, frameMat, x0 + bar, x0 + w - bar, y - t / 2, y + t / 2, ...zg));
    }
  }
}

/** Un vantail de porte, selon son modèle. */
function doorLeaf(leaf: THREE.Group, o: PlanOpening, pal: Palette, x0: number, w: number, y0: number, h: number) {
  const n = leaf.name;
  const style = o.style ?? 'plain';
  const color = o.color ?? (style === 'entry' ? '#5b4636' : PLAN_COLORS.door);
  const mat = pal.paint(color, 0.65);
  if (style === 'glazed') {
    glazedLeaf(leaf, pal, mat, x0, w, y0, h, 0, 0.09, true);
    return;
  }
  const thick = style === 'entry' ? LEAF * 1.5 : LEAF;
  leaf.add(box(`${n}_door`, mat, x0, x0 + w, y0, y0 + h, -thick / 2, thick / 2));
  if (style === 'panels' || style === 'entry') {
    // Panneaux en relief, sur les deux faces.
    const m = 0.1, gap = 0.08;
    const rows: [number, number][] = style === 'entry'
      ? [[y0 + 0.12, y0 + h * 0.45], [y0 + h * 0.5, y0 + h - 0.12]]
      : [[y0 + 0.12, y0 + h * 0.36], [y0 + h * 0.36 + gap, y0 + h - 0.12]];
    const darker = pal.paint(shade(color, -0.08), 0.65);
    for (const s of [-1, 1]) {
      rows.forEach(([ya, yb], i) => {
        if (style === 'entry' && i === 1) return;
        leaf.add(box(`${n}_panel_${s > 0 ? 'f' : 'b'}${i}`, darker, x0 + m, x0 + w - m, ya, yb, s > 0 ? thick / 2 : -thick / 2 - 0.012, s > 0 ? thick / 2 + 0.012 : -thick / 2));
      });
    }
    if (style === 'entry') {
      // Une fente vitrée en haut.
      const pane = box(`${n}_pane`, pal.glass(), x0 + w * 0.3, x0 + w * 0.7, y0 + h * 0.55, y0 + h - 0.15, -thick / 2 - 0.004, thick / 2 + 0.004);
      pane.castShadow = false;
      leaf.add(pane);
    }
  }
}

/** Éclaircit (k > 0) ou assombrit (k < 0) une couleur. */
function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + k)));
  return `#${c.getHexString()}`;
}

/**
 * Une ouverture : un cadre, et un ou deux vantaux (aucun pour un passage).
 *
 * Tout est construit dans un repère où le mur file le long de x local, puis le
 * support est tourné pour suivre le mur. Les vantaux restent ainsi dans les
 * axes de leur support : le moteur d'ouvrants y lit largeur, épaisseur et
 * gonds sans calcul.
 */
function buildOpening(plan: PlanDoc, o: PlanOpening, pal: Palette, group: THREE.Group) {
  const w = plan.walls.find((q) => q.id === o.wall)!;
  const [a, b] = wallEnds(plan, w);
  const dir = norm(sub(b, a));
  const t = thicknessOf(plan, w);
  const frame = new THREE.Group();
  frame.name = `plan_opening_${o.id}`;
  frame.position.set(a.x + dir.x * o.offset, 0, a.y + dir.y * o.offset);
  // x local suit le mur, de a vers b : « début » et « fin » gardent leur sens.
  frame.rotation.y = -Math.atan2(dir.y, dir.x);
  group.add(frame);

  const isDoor = o.kind === 'door' || o.kind === 'passage';
  const frameMat = pal.paint(isDoor ? PLAN_COLORS.frame : o.color ?? PLAN_COLORS.frame, 0.6);
  const width = o.width, h = o.height, s = o.sill;
  const depth = t + 0.02;
  frame.add(box(`plan_frame_${o.id}_l`, frameMat, -width / 2, -width / 2 + FRAME, s, s + h, -depth / 2, depth / 2));
  frame.add(box(`plan_frame_${o.id}_r`, frameMat, width / 2 - FRAME, width / 2, s, s + h, -depth / 2, depth / 2));
  frame.add(box(`plan_frame_${o.id}_t`, frameMat, -width / 2, width / 2, s + h - FRAME, s + h, -depth / 2, depth / 2));
  if (s > 0) frame.add(box(`plan_frame_${o.id}_b`, frameMat, -width / 2, width / 2, s, s + FRAME, -depth / 2, depth / 2));
  if (o.kind === 'passage') return;

  const innerW = width - 2 * FRAME;
  const bottom = s > 0 ? s + FRAME : s + 0.01;
  const innerH = s + h - FRAME - bottom;
  const leaves = o.kind === 'slider' || o.double ? 2 : 1;
  const leafW = leaves === 2 && o.kind === 'slider' ? innerW / 2 + 0.03 : innerW / leaves;
  const handleMat = pal.paint('#9aa0a6', 0.3, 0.8);

  for (let n = 0; n < leaves; n++) {
    const leaf = new THREE.Group();
    leaf.name = leafName(o.id, n + 1);
    const x0 = o.kind === 'slider'
      ? (n === 0 ? -innerW / 2 : innerW / 2 - leafW)
      : -innerW / 2 + n * leafW;
    // Un coulissant a deux rails : les panneaux se croisent sans se toucher.
    const z = o.kind === 'slider' ? (n === 0 ? -LEAF * 0.75 : LEAF * 0.75) : 0;
    const glazed = o.kind !== 'door' || o.style === 'glazed';
    if (o.kind === 'door') doorLeaf(leaf, o, pal, x0, leafW, bottom, innerH);
    else glazedLeaf(leaf, pal, frameMat, x0, leafW, bottom, innerH, z, 0.05, o.style === 'grid');
    // Poignée, du côté opposé aux gonds.
    const hingeAtStart = leaves === 2 ? n === 0 : o.hinge === 'start';
    const hx = hingeAtStart ? x0 + leafW - 0.09 : x0 + 0.06;
    const hy = o.kind === 'door' ? 1.0 : bottom + innerH / 2;
    leaf.add(box(`${leaf.name}_handle`, handleMat, hx, hx + 0.03, hy - 0.06, hy + 0.06, z - LEAF / 2 - 0.04, z + LEAF / 2 + 0.04));

    // Les deux vantaux d'une fenêtre ouvrent vers le milieu : gonds dehors.
    // Un coulissant glisse vers l'autre panneau ; le premier reste fixe.
    const side: 'start' | 'end' = o.kind === 'slider'
      ? (n === 0 ? 'end' : 'start')
      : leaves === 2 ? (n === 0 ? 'start' : 'end') : o.hinge;
    if (!(o.kind === 'slider' && n === 0)) {
      leaf.userData.owlnestLeaf = {
        motion: o.kind === 'slider' ? 'rail' : 'hinge', hinge: side, pane: glazed,
        size: [innerH, leafW, LEAF].sort((p, q) => q - p),
      };
    }
    leaf.userData.owlnestPlanOpening = o.id;
    frame.add(leaf);
  }
}

/** La maison complète. Le groupe rendu est neuf à chaque appel. */
export function buildPlan(plan: PlanDoc): THREE.Group {
  const root = new THREE.Group();
  root.name = 'owlnest_plan';
  const pal = new Palette();

  const all = faces(plan);
  const rooms: { room: PlanRoom; face: Face }[] = [];
  for (const r of plan.rooms) {
    const face = all.filter((f) => pointInPolygon(r.seed, f.poly)).sort((p, q) => p.area - q.area)[0];
    if (!face) continue;
    rooms.push({ room: r, face });
    const kind = r.floorMaterial ?? 'plain';
    const geo = prism(face.poly, -0.02, 0, kind === 'plain' ? 0 : TEXTURE_METERS[kind]);
    root.add(mesh(`room_${r.id}`, geo, pal.floor(r), false));
  }

  const feet = wallFootprints(plan);
  plan.walls.forEach((w, i) => {
    const foot = feet.get(w.id);
    if (foot && wallLength(plan, w) > 1e-3) buildWall(plan, w, foot, i, pal, rooms, root);
  });
  for (const o of plan.openings) {
    const w = plan.walls.find((q) => q.id === o.wall);
    if (w && !isBoundary(plan, w) && openingFits(plan, o)) buildOpening(plan, o, pal, root);
  }
  return root;
}

