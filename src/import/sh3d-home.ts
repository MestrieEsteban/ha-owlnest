/**
 * sh3d-home.ts — un fichier Sweet Home 3D (`.sh3d`) devenu plan modifiable.
 *
 * Un `.sh3d` est une archive zip. Depuis la version 5.3, elle contient
 * `Home.xml` : la maison décrite comme Sweet Home 3D la pense (murs, portes et
 * fenêtres, pièces, meubles), plus les modèles 3D des meubles, en OBJ.
 *
 * L'export OBJ, lui, ne donne que des triangles : il faut deviner ce qui est
 * une porte, où sont les pièces, quel meuble est contre quel mur. Ici tout est
 * dit, et le plan qui en sort se modifie dans l'éditeur comme un plan dessiné.
 *
 * Ce module est pur (ni DOM ni réseau) : lecture du XML et conversion.
 * L'envoi des meubles vit dans `sh3d-furniture.ts`.
 *
 * Unités Sweet Home 3D : centimètres, angles en radians dans le sens horaire
 * vu de dessus, `y` vers le bas du plan, comme notre plan (en mètres).
 */

import type { PlanDoc, PlanOpening, OpeningKind } from '../plan/types';
import { emptyPlan, OPENING_DEFAULTS } from '../plan/types';
import { addWall, cleanup, closeGaps, reconcileRooms, wallAt, wallEnds, newId, faces, degree, nodeOf } from '../plan/graph';
import { type Pt, sub, norm, dot, perp, pointInPolygon, round3 } from '../plan/geometry';

// ── Lecture du XML ─────────────────────────────────────────────────────────

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

/**
 * Un lecteur XML minimal : balises, attributs, imbrication. `Home.xml` est
 * écrit par une machine, sans texte utile entre les balises ; ce qui dépasse
 * (déclaration, commentaires) est ignoré.
 */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:'[^']*'|"[^"]*"))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  const attrRe = /([^\s=/>]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
  for (let m = tagRe.exec(text); m; m = tagRe.exec(text)) {
    if (!m[2]) continue;
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (closing) {
      while (stack.length > 1 && stack.pop()!.tag !== tag) { /* balise mal fermée : on remonte */ }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (let a = attrRe.exec(rawAttrs); a; a = attrRe.exec(rawAttrs)) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
    attrRe.lastIndex = 0;
    const node: XmlNode = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

// ── La maison ──────────────────────────────────────────────────────────────

export interface Sh3dWall {
  xStart: number; yStart: number; xEnd: number; yEnd: number;
  thickness: number;
  height?: number;
  heightAtEnd?: number;
  /** Mur courbe : angle de l'arc, en radians. */
  arcExtent?: number;
  level?: string;
  leftSideColor?: string;
  rightSideColor?: string;
}

export interface Sh3dSash { xAxis: number; yAxis: number; width: number; startAngle: number; endAngle: number }

export interface Sh3dPiece {
  /** `door` : porte ou fenêtre ; `light` : un luminaire. */
  kind: 'piece' | 'door' | 'light';
  name: string;
  catalogId?: string;
  /** Entrée du modèle dans l'archive : `3`, ou `17/ficus.obj`. */
  model?: string;
  x: number; y: number; elevation: number;
  width: number; depth: number; height: number;
  angle: number;
  level?: string;
  /** Couleur imposée à tout le meuble, `#rrggbb`. */
  color?: string;
  /** Couleurs imposées matière par matière. */
  materials: Record<string, string>;
  /** Rotation du modèle (matrice 3×3, par lignes) choisie dans Sweet Home 3D. */
  modelRotation?: number[];
  modelMirrored?: boolean;
  sashes: Sh3dSash[];
  /** Fraction de l'épaisseur du mur occupée par la porte, et décalage. */
  wallThickness?: number;
  wallDistance?: number;
}

export interface Sh3dRoom {
  name?: string;
  points: Pt[];
  floorColor?: string;
  level?: string;
}

export interface Sh3dLevel { id: string; name: string; elevation: number; elevationIndex: number }

export interface Sh3dHome {
  wallHeight: number;
  walls: Sh3dWall[];
  pieces: Sh3dPiece[];
  rooms: Sh3dRoom[];
  levels: Sh3dLevel[];
}

const num = (v: string | undefined, d = 0) => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};
const opt = (v: string | undefined) => (v === undefined ? undefined : num(v));

/** Couleur Sweet Home 3D (`AARRGGBB` en hexadécimal) en `#rrggbb`. */
export function sh3dColor(v: string | undefined): string | undefined {
  if (!v || !/^[0-9a-f]{6,8}$/i.test(v)) return undefined;
  return `#${v.slice(-6).toLowerCase()}`;
}

const PIECE_TAGS: Record<string, Sh3dPiece['kind']> = {
  pieceOfFurniture: 'piece', shelfUnit: 'piece', doorOrWindow: 'door', light: 'light',
};

function readPiece(n: XmlNode, kind: Sh3dPiece['kind']): Sh3dPiece | null {
  const a = n.attrs;
  if (a.visible === 'false') return null;
  const materials: Record<string, string> = {};
  for (const c of n.children) {
    if (c.tag !== 'material' || !c.attrs.name) continue;
    const col = sh3dColor(c.attrs.color);
    if (col) materials[c.attrs.name] = col;
  }
  return {
    kind,
    name: a.name ?? '',
    catalogId: a.catalogId,
    model: a.model,
    x: num(a.x), y: num(a.y), elevation: num(a.elevation),
    width: num(a.width), depth: num(a.depth), height: num(a.height),
    angle: num(a.angle),
    level: a.level,
    color: sh3dColor(a.color),
    materials,
    modelRotation: a.modelRotation ? a.modelRotation.trim().split(/\s+/).map(Number) : undefined,
    modelMirrored: a.modelMirrored === 'true',
    sashes: n.children.filter((c) => c.tag === 'sash').map((c) => ({
      xAxis: num(c.attrs.xAxis), yAxis: num(c.attrs.yAxis), width: num(c.attrs.width),
      startAngle: num(c.attrs.startAngle), endAngle: num(c.attrs.endAngle),
    })),
    wallThickness: opt(a.wallThickness),
    wallDistance: opt(a.wallDistance),
  };
}

/** La maison décrite par `Home.xml`. */
export function readHome(xml: string): Sh3dHome {
  const root = parseXml(xml);
  const home = root.children.find((c) => c.tag === 'home');
  if (!home) throw new Error('no-home');
  const out: Sh3dHome = { wallHeight: num(home.attrs.wallHeight, 250), walls: [], pieces: [], rooms: [], levels: [] };

  const visit = (n: XmlNode, groupLevel?: string) => {
    for (const c of n.children) {
      const kind = PIECE_TAGS[c.tag];
      if (kind) {
        const p = readPiece(c, kind);
        if (p) out.pieces.push({ ...p, level: p.level ?? groupLevel });
      } else if (c.tag === 'furnitureGroup') {
        // Un groupe ne fait que réunir : ses meubles ont leurs propres coordonnées.
        if (c.attrs.visible !== 'false') visit(c, c.attrs.level ?? groupLevel);
      } else if (c.tag === 'wall') {
        const a = c.attrs;
        out.walls.push({
          xStart: num(a.xStart), yStart: num(a.yStart), xEnd: num(a.xEnd), yEnd: num(a.yEnd),
          thickness: num(a.thickness, 10),
          height: opt(a.height), heightAtEnd: opt(a.heightAtEnd), arcExtent: opt(a.arcExtent),
          level: a.level,
          leftSideColor: sh3dColor(a.leftSideColor), rightSideColor: sh3dColor(a.rightSideColor),
        });
      } else if (c.tag === 'room') {
        out.rooms.push({
          name: c.attrs.name,
          points: c.children.filter((p) => p.tag === 'point').map((p) => ({ x: num(p.attrs.x), y: num(p.attrs.y) })),
          floorColor: c.attrs.floorVisible === 'false' ? undefined : sh3dColor(c.attrs.floorColor),
          level: c.attrs.level,
        });
      } else if (c.tag === 'level') {
        out.levels.push({
          id: c.attrs.id, name: c.attrs.name ?? '', elevation: num(c.attrs.elevation),
          elevationIndex: num(c.attrs.elevationIndex, 0),
        });
      }
    }
  };
  visit(home);
  return out;
}

// ── Conversion en plan ─────────────────────────────────────────────────────

/** Un meuble à poser une fois son modèle envoyé : `model` est encore l'entrée de l'archive. */
export interface PendingItem {
  piece: Sh3dPiece;
  x: number; y: number;
  rotation: number;
  size: [number, number, number];
  elevation: number;
  /** Le niveau du logement où il se pose (0 : le rez-de-chaussée). */
  floor?: number;
}

export interface Sh3dConversion {
  plan: PlanDoc;
  items: PendingItem[];
  /** Niveau importé, quand la maison en a plusieurs. */
  level?: Sh3dLevel;
  levels: number;
  /** Ce qui n'a pas pu être repris, pour le dire. */
  skipped: { curvedWalls: number; slopedWalls: number; openings: number };
  /** Bouts de mur recollés à leur voisin. */
  gaps: number;
  /** Limites de pièce ajoutées pour fermer les espaces ouverts. */
  boundaries: number;
}

const CM = 0.01;
const pt = (x: number, y: number): Pt => ({ x: x * CM, y: y * CM });

/** La valeur la plus fréquente, pour les réglages communs du plan. */
function mostCommon(values: number[], fallback: number): number {
  const count = new Map<number, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best = fallback, n = 0;
  for (const [v, c] of count) if (c > n) { best = v; n = c; }
  return best;
}

/**
 * Les points d'un mur courbe, approché par des segments droits (un tous les
 * 15°). L'arc passe par les deux bouts du mur et couvre `arcExtent` ; son
 * signe dit de quel côté il se bombe.
 */
export function arcPoints(w: Sh3dWall): Pt[] {
  const a = { x: w.xStart, y: w.yStart }, b = { x: w.xEnd, y: w.yEnd };
  const ext = w.arcExtent ?? 0;
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (Math.abs(ext) < 1e-3 || chord < 1e-6) return [a, b];
  const n = perp(norm(sub(b, a)));
  const h = chord / 2 / Math.tan(ext / 2);
  const c = { x: (a.x + b.x) / 2 + n.x * h, y: (a.y + b.y) / 2 + n.y * h };
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  // Le sens de parcours qui arrive bien sur l'autre bout.
  const miss = (sw: number) => Math.hypot(c.x + r * Math.cos(a0 + sw) - b.x, c.y + r * Math.sin(a0 + sw) - b.y);
  const sweep = miss(ext) <= miss(-ext) ? ext : -ext;
  const steps = Math.max(2, Math.ceil(Math.abs(ext) / (Math.PI / 12)));
  const out: Pt[] = [a];
  for (let i = 1; i < steps; i++) {
    const t = a0 + (sweep * i) / steps;
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  out.push(b);
  return out;
}

/** Porte, fenêtre, baie ou passage, d'après ce que Sweet Home 3D en dit. */
export function openingKind(p: Sh3dPiece): OpeningKind {
  const s = `${p.catalogId ?? ''} ${p.name}`.toLowerCase();
  if (/slid|coulis|garage|baie/.test(s)) return 'slider';
  if (/window|fen[eê]tre|velux|hublot/.test(s)) return 'window';
  if (!p.sashes.length) return 'passage';
  return 'door';
}

/** Les niveaux qui ont des murs, du plus bas au plus haut : ceux qu'on peut importer. */
export function levelChoices(home: Sh3dHome): { id: string; name: string; walls: number }[] {
  const levels = [...home.levels].sort((a, b) => a.elevation - b.elevation || a.elevationIndex - b.elevationIndex);
  const first = levels[0];
  return levels
    .map((l) => ({ id: l.id, name: l.name, walls: home.walls.filter((w) => w.level === l.id || (!w.level && l === first)).length }))
    .filter((l) => l.walls > 0);
}

/**
 * Le plan d'une maison Sweet Home 3D, et ses meubles à poser.
 *
 * Un seul niveau : `levelId` s'il est donné, sinon le plus bas qui ait des
 * murs. Pour toute la maison, voir `homeToHouse`.
 */
export function homeToPlan(home: Sh3dHome, names: { room: () => string; floor: () => string }, levelId?: string): Sh3dConversion {
  const levels = [...home.levels].sort((a, b) => a.elevation - b.elevation || a.elevationIndex - b.elevationIndex);
  const level = (levelId ? levels.find((l) => l.id === levelId) : undefined)
    ?? levels.find((l) => home.walls.some((w) => w.level === l.id)) ?? levels[0];
  const onLevel = <T extends { level?: string }>(x: T) => !level || x.level === level.id || (!x.level && level === levels[0]);
  const walls = home.walls.filter(onLevel);
  const pieces = home.pieces.filter(onLevel);
  const skipped = { curvedWalls: 0, slopedWalls: 0, openings: 0 };

  const plan = emptyPlan();
  const heightOf = (w: Sh3dWall) => {
    const h = w.height ?? home.wallHeight;
    // Un mur en pente devient droit, à mi-hauteur : l'éditeur n'en fait pas.
    if (w.heightAtEnd !== undefined && Math.abs(w.heightAtEnd - h) > 1) { skipped.slopedWalls++; return (h + w.heightAtEnd) / 2; }
    return h;
  };
  plan.wallHeight = round3(mostCommon(walls.map(heightOf), home.wallHeight) * CM);
  plan.wallThickness = round3(mostCommon(walls.map((w) => w.thickness), 15) * CM);
  skipped.slopedWalls = 0; // compté pour de bon ci-dessous

  // Les murs : chacun garde son épaisseur et sa hauteur quand elles diffèrent du plan.
  for (const w of walls) {
    const h = round3(heightOf(w) * CM), t = round3(w.thickness * CM);
    const opts = {
      ...(Math.abs(t - plan.wallThickness) > 1e-3 ? { thickness: t } : {}),
      ...(Math.abs(h - plan.wallHeight) > 1e-3 ? { height: h } : {}),
    };
    const pts = arcPoints(w);
    if (pts.length > 2) skipped.curvedWalls++;
    for (let i = 0; i + 1 < pts.length; i++) addWall(plan, pt(pts[i].x, pts[i].y), pt(pts[i + 1].x, pts[i + 1].y), opts);
  }
  cleanup(plan);
  // Les murs qui s'arrêtent juste avant un autre ferment mal les pièces.
  const gaps = closeGaps(plan);

  // Portes et fenêtres : sur le mur qui les porte, à leur place le long de lui.
  for (const p of pieces.filter((q) => q.kind === 'door')) {
    const c = pt(p.x, p.y);
    const hit = wallAt(plan, c, Math.max(0.3, p.depth * CM));
    if (!hit) { skipped.openings++; continue; }
    const [a, b] = wallEnds(plan, hit.wall);
    const dir = norm(sub(b, a));
    // L'axe de la porte (sa largeur) doit suivre le mur.
    const ax = { x: Math.cos(p.angle), y: Math.sin(p.angle) };
    if (Math.abs(dot(ax, dir)) < 0.7) { skipped.openings++; continue; }
    const kind = openingKind(p);
    const width = round3(p.width * CM);
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (width > L + 0.05) { skipped.openings++; continue; }
    // Gonds : le premier vantail tourne autour d'un axe à gauche ou à droite du modèle.
    const sash = p.sashes[0];
    const leftIsStart = dot(ax, dir) > 0;
    const hingeLeft = sash ? sash.xAxis < 0.5 : true;
    // L'avant du modèle regarde vers son +y local : c'est de ce côté que s'ouvre un battant.
    const front = { x: -Math.sin(p.angle), y: Math.cos(p.angle) };
    const o: PlanOpening = {
      id: newId('o'), kind, wall: hit.wall.id,
      offset: round3(Math.min(Math.max(hit.offset, width / 2), L - width / 2)),
      width,
      height: round3(p.height * CM),
      sill: round3(p.elevation * CM),
      hinge: hingeLeft === leftIsStart ? 'start' : 'end',
      swing: dot(front, perp(dir)) > 0 ? 'front' : 'back',
      ...(p.sashes.length >= 2 ? { double: true } : {}),
    };
    // Une porte-fenêtre posée au sol reste une fenêtre (vitrée), pas une porte pleine.
    if (kind === 'window' && o.sill < 0.05 && o.height > 1.8) o.style = 'grid';
    if (kind === 'passage' && !o.height) Object.assign(o, OPENING_DEFAULTS.passage);
    plan.openings.push(o);
  }

  // Les espaces ouverts (cuisine sur le salon, palier) : une limite de pièce
  // les ferme, pour qu'ils aient un sol et un nom.
  const boundaries = closeOpenAreas(plan);

  // Les pièces nommées dans Sweet Home 3D, puis celles que les murs ferment.
  const all = faces(plan);
  for (const r of home.rooms.filter(onLevel)) {
    if (r.points.length < 3) continue;
    const poly = r.points.map((q) => pt(q.x, q.y));
    const c = poly.reduce((s, q) => ({ x: s.x + q.x / poly.length, y: s.y + q.y / poly.length }), { x: 0, y: 0 });
    const seed = pointInPolygon(c, poly) ? c : insideOf(poly);
    if (!all.some((f) => pointInPolygon(seed, f.poly))) continue;
    plan.rooms.push({
      id: newId('r'), name: r.name?.trim() || names.room(),
      ...(r.floorColor ? { floor: r.floorColor } : {}),
      seed: { x: round3(seed.x), y: round3(seed.y) },
    });
  }
  reconcileRooms(plan, names.room, names.floor);
  paintWalls(plan, walls);

  // Les meubles : à leur place exacte, à la hauteur choisie dans Sweet Home 3D.
  const items: PendingItem[] = pieces
    .filter((p) => p.kind !== 'door' && p.model && p.width > 0 && p.depth > 0 && p.height > 0)
    .map((p) => ({
      piece: p,
      x: round3(p.x * CM), y: round3(p.y * CM),
      rotation: Math.round((((p.angle * 180) / Math.PI) % 360 + 360) % 360),
      size: [round3(p.width * CM), round3(p.depth * CM), round3(p.height * CM)],
      elevation: round3(p.elevation * CM),
    }));

  return { plan, items, level, levels: home.levels.length, skipped, gaps, boundaries };
}

export interface Sh3dHouse {
  /** Le rez-de-chaussée, ses étages dans `floors`. */
  plan: PlanDoc;
  /** Les meubles de tous les niveaux, chacun avec son niveau. */
  items: PendingItem[];
  /** Le niveau devenu rez-de-chaussée. */
  ground?: Sh3dLevel;
  /** Les niveaux importés (ceux qui ont des murs). */
  levels: number;
  skipped: Sh3dConversion['skipped'];
}

/**
 * Toute la maison : chaque niveau qui a des murs devient un étage, à sa
 * hauteur au-dessus du plus bas. Sweet Home 3D place tous les niveaux dans le
 * même repère : les étages tombent pile au-dessus les uns des autres.
 */
export function homeToHouse(home: Sh3dHome, names: { room: () => string; floor: () => string }): Sh3dHouse {
  const choices = levelChoices(home);
  if (choices.length < 2) {
    const conv = homeToPlan(home, names, choices[0]?.id);
    return { plan: conv.plan, items: conv.items, ground: conv.level, levels: 1, skipped: conv.skipped };
  }
  const convs = choices.map((c) => homeToPlan(home, names, c.id));
  const [ground, ...ups] = convs;
  const base = ground.level?.elevation ?? 0;
  const skipped = { curvedWalls: 0, slopedWalls: 0, openings: 0 };
  for (const c of convs) {
    skipped.curvedWalls += c.skipped.curvedWalls;
    skipped.slopedWalls += c.skipped.slopedWalls;
    skipped.openings += c.skipped.openings;
  }
  const plan: PlanDoc = {
    ...ground.plan,
    ...(ground.level?.name ? { groundName: ground.level.name } : {}),
    floors: ups.map((c, i) => ({
      id: newId('f'),
      name: c.level?.name || `${i + 1}`,
      elevation: round3(((c.level?.elevation ?? 0) - base) * CM),
      doc: c.plan,
    })),
  };
  const items = convs.flatMap((c, k) => c.items.map((it) => ({ ...it, floor: k })));
  return { plan, items, ground: ground.level, levels: convs.length, skipped };
}

/**
 * Ferme les espaces ouverts par des limites de pièce (des murs de hauteur
 * nulle) : depuis chaque bout de mur libre, vers le mur qu'il vise ou le coin
 * le plus proche devant lui, à moins de `reach`. Une limite n'est gardée que
 * si elle ferme vraiment un espace de plus : sinon elle ne ferait que rayer
 * le plan.
 */
export function closeOpenAreas(plan: PlanDoc, reach = 3): number {
  let added = 0;
  // Une pièce minuscule (un liseré entre un mur et sa limite) n'en est pas une.
  const small = (fs: ReturnType<typeof faces>) => fs.filter((f) => f.area < 0.8).length;
  for (let guard = 0; guard < 50; guard++) {
    const fs = faces(plan);
    const before = fs.length, smallBefore = small(fs);
    let progress = false;
    for (const node of plan.nodes) {
      if (degree(plan, node.id) !== 1) continue;
      const w = plan.walls.find((x) => x.a === node.id || x.b === node.id)!;
      const o = nodeOf(plan, w.a === node.id ? w.b : w.a)!;
      const dir = norm(sub(node, o));
      const targets: Pt[] = [];
      // Le mur droit devant.
      for (const q of plan.walls) {
        if (q === w) continue;
        const [a, b] = wallEnds(plan, q);
        const e = sub(b, a);
        const den = dir.x * e.y - dir.y * e.x;
        if (Math.abs(den) < 1e-9) continue;
        const ax = sub(a, node);
        const t = (ax.x * e.y - ax.y * e.x) / den, u = (ax.x * dir.y - ax.y * dir.x) / den;
        if (t > 0.05 && t <= reach && u >= 0 && u <= 1) targets.push({ x: node.x + dir.x * t, y: node.y + dir.y * t });
      }
      // Les coins devant, du plus proche au plus loin ; un autre bout libre,
      // dans n'importe quelle direction (le côté ouvert d'une pièce en U).
      for (const q of plan.nodes) {
        if (q.id === node.id || q.id === o.id) continue;
        const v = sub(q, node), d = Math.hypot(v.x, v.y);
        const free = degree(plan, q.id) === 1;
        if (d > 0.05 && ((d <= reach && dot(v, dir) / d > 0.3) || (free && d <= reach * 4 / 3))) targets.push(q);
      }
      targets.sort((p, q) => Math.hypot(p.x - node.x, p.y - node.y) - Math.hypot(q.x - node.x, q.y - node.y));
      for (const target of targets) {
        const snapshot = JSON.stringify(plan);
        addWall(plan, { x: node.x, y: node.y }, target, { height: 0 });
        const after = faces(plan);
        if (after.length > before && small(after) <= smallBefore) { added++; progress = true; break; }
        Object.assign(plan, JSON.parse(snapshot));
      }
      if (progress) break;
    }
    if (!progress) break;
  }
  return added;
}

/** Un point à l'intérieur d'un polygone, quand son centre tombe dehors (pièce en L). */
function insideOf(poly: readonly Pt[]): Pt {
  for (let i = 1; i + 1 < poly.length; i++) {
    const c = { x: (poly[0].x + poly[i].x + poly[i + 1].x) / 3, y: (poly[0].y + poly[i].y + poly[i + 1].y) / 3 };
    if (pointInPolygon(c, poly)) return c;
  }
  return poly[0];
}

/**
 * Les couleurs des murs : chaque face d'un mur Sweet Home 3D a sa couleur.
 * Une pièce prend la couleur la plus présente sur ses murs, vue de dedans ;
 * l'extérieur, celle des faces qui ne regardent aucune pièce.
 */
function paintWalls(plan: PlanDoc, walls: Sh3dWall[]) {
  const all = faces(plan);
  const roomOf = (p: Pt) => {
    const f = all.filter((g) => pointInPolygon(p, g.poly)).sort((x, y) => x.area - y.area)[0];
    return f ? plan.rooms.find((r) => pointInPolygon(r.seed, f.poly) && !all.some((g) => g.area < f.area && pointInPolygon(r.seed, g.poly))) : undefined;
  };
  const votes = new Map<string, Map<string, number>>();
  const vote = (key: string, color: string) => {
    const m = votes.get(key) ?? new Map<string, number>();
    m.set(color, (m.get(color) ?? 0) + 1);
    votes.set(key, m);
  };
  for (const w of walls) {
    const a = pt(w.xStart, w.yStart), b = pt(w.xEnd, w.yEnd);
    const d = norm(sub(b, a));
    // Le côté droit, en marchant du début à la fin du mur sur le plan (y vers le bas).
    const right = { x: -d.y, y: d.x };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const off = w.thickness * CM / 2 + 0.1;
    for (const [color, s] of [[w.rightSideColor, 1], [w.leftSideColor, -1]] as const) {
      if (!color) continue;
      const room = roomOf({ x: mid.x + right.x * off * s, y: mid.y + right.y * off * s });
      vote(room ? room.id : '#outside', color);
    }
  }
  const winner = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])[0][0];
  for (const r of plan.rooms) {
    const m = votes.get(r.id);
    if (m) r.wall = winner(m);
  }
  const out = votes.get('#outside');
  if (out) plan.outside = winner(out);
}
