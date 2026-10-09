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
import type { PlanDoc, PlanOpening } from './types';
import { wallsOf, wallFor, wallPieces, type Attached, type Wall } from './walls';

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

/** Un pavé, posé par ses bornes. */
function box(name: string, mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(Math.max(x1 - x0, 1e-4), Math.max(y1 - y0, 1e-4), Math.max(z1 - z0, 1e-4));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Les blocs d'un mur, en coordonnées de la maison.
 *
 * Aux deux bouts, le mur déborde d'une demi-épaisseur pour fermer les angles.
 * Deux murs qui se croisent ont alors un carré en commun : les murs le long
 * de y sont abaissés d'un millimètre pour que leurs dessus ne se battent pas
 * à l'écran avec ceux le long de x. Invisible, et sans calcul d'intersection.
 */
function buildWall(wall: Wall, holes: Attached[], index: number, mat: THREE.Material, group: THREE.Group) {
  const half = wall.thickness / 2;
  const drop = wall.axis === 'y' ? 0.001 : 0;
  const pieces = wallPieces(wall, holes.map((h) => ({
    center: h.center, width: h.opening.width, sill: h.opening.sill, height: h.opening.height,
  })));
  pieces.forEach((p, k) => {
    const a = p.a <= wall.from + 1e-3 ? p.a - half : p.a;
    const b = p.b >= wall.to - 1e-3 ? p.b + half : p.b;
    const top = p.top >= wall.height - 1e-3 ? p.top - drop : p.top;
    const name = `wall_${index}_${k}`;
    const mesh = wall.axis === 'x'
      ? box(name, mat, a, b, p.bottom, top, wall.at - half, wall.at + half)
      : box(name, mat, wall.at - half, wall.at + half, p.bottom, top, a, b);
    group.add(mesh);
  });
}

/**
 * Une ouverture : un cadre, et un ou deux vantaux.
 *
 * Tout est construit dans un repère où le mur file le long de x local, puis le
 * support est tourné pour suivre le mur. Les vantaux restent ainsi dans les
 * axes de leur support : le moteur d'ouvrants y lit largeur, épaisseur et
 * gonds sans calcul.
 */
function buildOpening(at: Attached, m: Materials, group: THREE.Group) {
  const o = at.opening;
  const t = at.wall.thickness;
  const frame = new THREE.Group();
  frame.name = `plan_opening_${o.id}`;
  if (at.wall.axis === 'x') frame.position.set(at.center, 0, at.wall.at);
  else {
    frame.position.set(at.wall.at, 0, at.center);
    // x local → z de la maison : l'ordre « début → fin » du mur est gardé.
    frame.rotation.y = -Math.PI / 2;
  }
  group.add(frame);

  const w = o.width, h = o.height, s = o.sill;
  const depth = t + 0.02;
  // Montants et traverse ; une fenêtre a aussi un appui.
  frame.add(box(`plan_frame_${o.id}_l`, m.frame, -w / 2, -w / 2 + FRAME, s, s + h, -depth / 2, depth / 2));
  frame.add(box(`plan_frame_${o.id}_r`, m.frame, w / 2 - FRAME, w / 2, s, s + h, -depth / 2, depth / 2));
  frame.add(box(`plan_frame_${o.id}_t`, m.frame, -w / 2, w / 2, s + h - FRAME, s + h, -depth / 2, depth / 2));
  if (s > 0) frame.add(box(`plan_frame_${o.id}_b`, m.frame, -w / 2, w / 2, s, s + FRAME, -depth / 2, depth / 2));

  const innerW = w - 2 * FRAME;
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

    const motion = o.kind === 'slider' ? 'rail' : 'hinge';
    // Les deux vantaux d'une fenêtre ouvrent vers le milieu : gonds dehors.
    // Un coulissant glisse vers l'autre panneau.
    const side: 'start' | 'end' = o.kind === 'slider'
      ? (n === 0 ? 'end' : 'start')
      : leaves === 2 ? (n === 0 ? 'start' : 'end') : o.hinge;
    leaf.userData.owlnestLeaf = {
      motion, hinge: side, pane: glazed,
      size: [innerH, leafW, LEAF].sort((a, b) => b - a),
    };
    leaf.userData.owlnestPlanOpening = o.id;
    // Un coulissant n'a qu'un panneau mobile : le second reste fixe.
    if (o.kind === 'slider' && n === 0) leaf.userData.owlnestLeaf = undefined;
    frame.add(leaf);
  }
}

/** La maison complète. Le groupe rendu est neuf à chaque appel. */
export function buildPlan(plan: PlanDoc): THREE.Group {
  const root = new THREE.Group();
  root.name = 'owlnest_plan';
  const m = materials();
  const walls = wallsOf(plan);

  for (const r of plan.rooms) {
    if (!(r.w > 0 && r.d > 0)) continue;
    const floor = box(`room_${r.id}`, m.floor(r.floor ?? '#c9b08a'), r.x, r.x + r.w, -0.02, 0, r.y, r.y + r.d);
    floor.castShadow = false;
    root.add(floor);
  }

  const attached = plan.openings
    .map((o) => wallFor(o, walls))
    .filter((a): a is Attached => !!a);
  walls.forEach((wall, i) => buildWall(wall, attached.filter((a) => a.wall.id === wall.id), i, m.wall, root));
  for (const a of attached) buildOpening(a, m, root);
  return root;
}

/** Ouvertures du plan qui ne tiennent sur aucun mur (pièce réduite, mur supprimé). */
export function orphanOpenings(plan: PlanDoc): PlanOpening[] {
  const walls = wallsOf(plan);
  return plan.openings.filter((o) => !wallFor(o, walls));
}
