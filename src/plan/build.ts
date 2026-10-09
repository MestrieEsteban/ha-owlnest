/**
 * plan/build.ts — la maison en 3D, construite à partir du plan.
 *
 * Murs, sols, portes et fenêtres sont fabriqués ici, à chaque chargement et à
 * chaque retouche. Les noms suivent les conventions déjà connues du reste de
 * la carte : `wall_…` et `room_…` comme un export Sweet Home 3D, et chaque
 * vantail porte, comme à l'import, ses informations d'ouvrant (`owlnestLeaf`).
 * Une porte dessinée est donc un ouvrant dès sa création.
 */

import * as THREE from 'three';
import type { PlanDoc, PlanOpening, PlanWall } from './types';
import { type Pt, sub, norm, dist, clipAlong, area } from './geometry';
import { wallEnds, wallLength, heightOf, thicknessOf, openingFits, faces, roomPolygon } from './graph';
import { wallFootprints } from './footprint';

/** Préfixe des vantaux construits depuis le plan : `plan_leaf_<ouverture>_<n>`. */
export const PLAN_LEAF = 'plan_leaf_';

export function leafName(openingId: string, n: number): string {
  return `${PLAN_LEAF}${openingId}_${n}`;
}

const FRAME = 0.05;   // largeur du cadre
const LEAF = 0.04;    // épaisseur d'un vantail

interface Materials {
  wall: THREE.Material;
  frame: THREE.Material;
  leaf: THREE.Material;
  glass: THREE.Material;
  handle: THREE.Material;
  floor: (color: string) => THREE.Material;
}

function materials(): Materials {
  const floors = new Map<string, THREE.Material>();
  return {
    wall: new THREE.MeshStandardMaterial({ color: '#ece8e1', roughness: 0.92 }),
    frame: new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.6 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#c8a77e', roughness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({
      color: '#bfe3f5', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false,
    }),
    handle: new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.3, metalness: 0.8 }),
    floor: (color) => {
      let m = floors.get(color);
      if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 }); floors.set(color, m); }
      return m;
    },
  };
}

/**
 * Un prisme droit : un contour vu de dessus (x, y du plan → x, z de la scène),
 * de la hauteur `y0` à `y1`. Le contour peut être concave (pièce en L).
 */
export function prism(poly: readonly Pt[], y0: number, y1: number): THREE.BufferGeometry {
  const pts = area(poly) < 0 ? [...poly].reverse() : [...poly];
  const v2 = pts.map((p) => new THREE.Vector2(p.x, p.y));
  const tris = THREE.ShapeUtils.triangulateShape(v2, []);
  const pos: number[] = [];
  const push = (p: Pt, y: number) => pos.push(p.x, y, p.y);
  for (const [a, b, c] of tris) {
    // Dessus vers le haut, dessous vers le bas.
    push(pts[a], y1); push(pts[c], y1); push(pts[b], y1);
    push(pts[a], y0); push(pts[b], y0); push(pts[c], y0);
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    push(p, y0); push(p, y1); push(q, y1);
    push(p, y0); push(q, y1); push(q, y0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
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

/**
 * Les blocs d'un mur : la semelle découpée le long du mur autour des
 * ouvertures (pleine hauteur entre elles, allège dessous, linteau dessus).
 */
function buildWall(plan: PlanDoc, w: PlanWall, foot: Pt[], index: number, mat: THREE.Material, group: THREE.Group) {
  const [a, b] = wallEnds(plan, w);
  const dir = norm(sub(b, a));
  const L = dist(a, b);
  const H = heightOf(plan, w);
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
    group.add(mesh(`wall_${index}_${k}`, prism(poly, p.y0, p.y1), mat));
  });
  void L;
}

/**
 * Une ouverture : un cadre, et un ou deux vantaux (aucun pour un passage).
 *
 * Tout est construit dans un repère où le mur file le long de x local, puis le
 * support est tourné pour suivre le mur. Les vantaux restent ainsi dans les
 * axes de leur support : le moteur d'ouvrants y lit largeur, épaisseur et
 * gonds sans calcul.
 */
function buildOpening(plan: PlanDoc, o: PlanOpening, m: Materials, group: THREE.Group) {
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

  const width = o.width, h = o.height, s = o.sill;
  const depth = t + 0.02;
  frame.add(box(`plan_frame_${o.id}_l`, m.frame, -width / 2, -width / 2 + FRAME, s, s + h, -depth / 2, depth / 2));
  frame.add(box(`plan_frame_${o.id}_r`, m.frame, width / 2 - FRAME, width / 2, s, s + h, -depth / 2, depth / 2));
  frame.add(box(`plan_frame_${o.id}_t`, m.frame, -width / 2, width / 2, s + h - FRAME, s + h, -depth / 2, depth / 2));
  if (s > 0) frame.add(box(`plan_frame_${o.id}_b`, m.frame, -width / 2, width / 2, s, s + FRAME, -depth / 2, depth / 2));
  if (o.kind === 'passage') return;

  const innerW = width - 2 * FRAME;
  const bottom = s > 0 ? s + FRAME : s + 0.01;
  const innerH = s + h - FRAME - bottom;
  const leaves = o.kind === 'slider' || o.double ? 2 : 1;
  const leafW = leaves === 2 && o.kind === 'slider' ? innerW / 2 + 0.03 : innerW / leaves;

  for (let n = 0; n < leaves; n++) {
    const leaf = new THREE.Group();
    leaf.name = leafName(o.id, n + 1);
    const x0 = o.kind === 'slider'
      ? (n === 0 ? -innerW / 2 : innerW / 2 - leafW)
      : -innerW / 2 + n * leafW;
    // Un coulissant a deux rails : les panneaux se croisent sans se toucher.
    const z = o.kind === 'slider' ? (n === 0 ? -LEAF * 0.75 : LEAF * 0.75) : 0;
    const glazed = o.kind !== 'door';
    if (glazed) {
      const bar = 0.05;
      leaf.add(box(`${leaf.name}_frame_l`, m.frame, x0, x0 + bar, bottom, bottom + innerH, z - LEAF / 2, z + LEAF / 2));
      leaf.add(box(`${leaf.name}_frame_r`, m.frame, x0 + leafW - bar, x0 + leafW, bottom, bottom + innerH, z - LEAF / 2, z + LEAF / 2));
      leaf.add(box(`${leaf.name}_frame_t`, m.frame, x0, x0 + leafW, bottom + innerH - bar, bottom + innerH, z - LEAF / 2, z + LEAF / 2));
      leaf.add(box(`${leaf.name}_frame_b`, m.frame, x0, x0 + leafW, bottom, bottom + bar, z - LEAF / 2, z + LEAF / 2));
      const pane = box(`${leaf.name}_pane`, m.glass, x0 + bar, x0 + leafW - bar, bottom + bar, bottom + innerH - bar, z - 0.006, z + 0.006);
      pane.castShadow = false;
      leaf.add(pane);
    } else {
      leaf.add(box(`${leaf.name}_door`, m.leaf, x0, x0 + leafW, bottom, bottom + innerH, z - LEAF / 2, z + LEAF / 2));
    }
    // Poignée, du côté opposé aux gonds.
    const hingeAtStart = leaves === 2 ? n === 0 : o.hinge === 'start';
    const hx = hingeAtStart ? x0 + leafW - 0.09 : x0 + 0.06;
    const hy = o.kind === 'door' ? 1.0 : bottom + innerH / 2;
    leaf.add(box(`${leaf.name}_handle`, m.handle, hx, hx + 0.03, hy - 0.06, hy + 0.06, z - LEAF / 2 - 0.04, z + LEAF / 2 + 0.04));

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
  const m = materials();

  const all = faces(plan);
  for (const r of plan.rooms) {
    const poly = roomPolygon(plan, r.id, all);
    if (!poly) continue;
    root.add(mesh(`room_${r.id}`, prism(poly, -0.02, 0), m.floor(r.floor ?? '#c9b08a'), false));
  }

  const feet = wallFootprints(plan);
  plan.walls.forEach((w, i) => {
    const foot = feet.get(w.id);
    if (foot && wallLength(plan, w) > 1e-3) buildWall(plan, w, foot, i, m.wall, root);
  });
  for (const o of plan.openings) if (openingFits(plan, o)) buildOpening(plan, o, m, root);
  return root;
}
