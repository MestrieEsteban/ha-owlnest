/**
 * model-outline.ts — arborescence du modèle, façon « Outliner » de Blender.
 *
 * Un ouvrant peut désigner un nœud entier du modèle (objet, groupe) au lieu
 * d'une pièce détachée d'une maille. Il faut pour cela un identifiant qui
 * survive aux modifications que la carte apporte elle-même au graphe : animer
 * un nœud le déplace sous un pivot, ce qui change l'ordre de `traverse`.
 *
 * On numérote donc le graphe **une fois, tel que chargé**, et ce rang est
 * inscrit sur chaque objet. Tout ce que la carte ajoute ensuite (pivots,
 * surlignage) n'a pas de rang et reste invisible pour l'arborescence.
 */
import * as THREE from 'three';

const RANK = '__owlnestRank';
const MESH_RANK = '__owlnestMeshRank';
const OUTLINE = '__owlnestOutline';

/** Une ligne de l'arborescence. */
export interface OutlineNode {
  /** Rang du nœud dans le graphe d'origine, racine exclue. */
  rank: number;
  name: string;
  /** Rang parmi les mailles, pour rejoindre `meshOrder` ; -1 hors maille. */
  meshRank: number;
  /** Triangles du sous-arbre, pour juger d'un coup d'œil ce qu'on désigne. */
  tris: number;
  /** Matériau d'une maille : un objet multi-matériau arrive en un groupe de mailles. */
  material?: string;
  parent: OutlineNode | null;
  children: OutlineNode[];
}

export interface ModelOutline {
  /** Enfants directs de la racine. */
  roots: OutlineNode[];
  /** Toutes les lignes, indexées par rang. */
  byRank: OutlineNode[];
}

function triangleCount(mesh: THREE.Mesh): number {
  const g = mesh.geometry;
  const idx = g.getIndex();
  return ((idx ? idx.count : g.getAttribute('position')?.count ?? 0) / 3) | 0;
}

/** Objets créés par la carte : pivots d'ouvrants, surlignage. */
function isRuntime(o: THREE.Object3D): boolean {
  return !!(o.userData.owlnestPartId || o.userData.owlnestHelper);
}

/**
 * Numérote le graphe s'il ne l'est pas encore, et en garde l'arborescence.
 *
 * À appeler sur le modèle fraîchement chargé. Les appels suivants ne font
 * rien : le rang doit rester celui du fichier, pas celui du graphe remanié.
 */
export function stampOrder(root: THREE.Object3D): ModelOutline {
  const cached = root.userData[OUTLINE] as ModelOutline | undefined;
  if (cached) return cached;

  const byRank: OutlineNode[] = [];
  const roots: OutlineNode[] = [];
  let meshes = 0;

  const visit = (o: THREE.Object3D, parent: OutlineNode | null) => {
    if (isRuntime(o)) return;
    const mesh = o as THREE.Mesh;
    const node: OutlineNode = {
      rank: byRank.length,
      name: o.name,
      meshRank: mesh.isMesh ? meshes++ : -1,
      tris: mesh.isMesh ? triangleCount(mesh) : 0,
      parent,
      children: [],
    };
    if (mesh.isMesh) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat?.name) node.material = mat.name;
      o.userData[MESH_RANK] = node.meshRank;
    }
    o.userData[RANK] = node.rank;
    byRank.push(node);
    (parent ? parent.children : roots).push(node);
    // Même ordre que `traverse` : parent d'abord, enfants dans l'ordre.
    for (const c of o.children) visit(c, node);
  };
  for (const c of root.children) visit(c, null);

  // Les triangles d'un groupe sont ceux de tout son contenu.
  for (let i = byRank.length - 1; i >= 0; i--) {
    const n = byRank[i];
    if (n.parent) n.parent.tris += n.tris;
  }

  const outline = { roots, byRank };
  root.userData[OUTLINE] = outline;
  return outline;
}

export function rankOf(o: THREE.Object3D): number | undefined {
  return o.userData[RANK] as number | undefined;
}

export function meshRankOf(o: THREE.Object3D): number | undefined {
  return o.userData[MESH_RANK] as number | undefined;
}

/** Nœuds du modèle indexés par rang d'origine, où qu'ils soient désormais. */
export function nodeOrder(root: THREE.Object3D): THREE.Object3D[] {
  const outline = stampOrder(root);
  const out: THREE.Object3D[] = new Array(outline.byRank.length);
  root.traverse((o) => {
    const r = rankOf(o);
    if (r !== undefined && o !== root) out[r] = o;
  });
  return out;
}

/**
 * Retrouve le nœud d'une configuration : par rang, sinon par nom.
 *
 * Même règle que pour les mailles : le rang tranche entre homonymes, mais un
 * rang dont le nom ne concorde plus n'est pas suivi — un modèle réexporté a pu
 * changer d'ordre, et animer un autre objet serait pire qu'un ouvrant absent.
 */
export function resolveNode(
  order: ReadonlyArray<THREE.Object3D | undefined>,
  cfg: { node: string; nodeIndex?: number },
): THREE.Object3D | null {
  if (cfg.nodeIndex !== undefined) {
    const byIndex = order[cfg.nodeIndex];
    if (byIndex && byIndex.name === cfg.node) return byIndex;
  }
  return order.find((o) => !!o && o.name === cfg.node) ?? null;
}

// ── Filtre ──────────────────────────────────────────────────────────────────

/**
 * Forme comparable d'un nom.
 *
 * `GLTFLoader` remplace les espaces des noms Blender par des soulignés : sans
 * cette normalisation, « puerta terraza » ne trouverait pas `puerta_terraza`.
 * Les accents tombent aussi, pour qu'un clavier sans accents suffise.
 */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[_.\-#]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface OutlineFilter {
  /** Rangs à afficher ; `null` quand le filtre est vide. */
  visible: Set<number> | null;
  /** Rangs à déplier pour rendre les correspondances visibles. */
  expand: Set<number>;
  /** Nœuds dont le nom correspond. */
  matches: Set<number>;
}

/**
 * Applique un filtre à l'arborescence.
 *
 * Tous les mots doivent figurer dans le nom, dans n'importe quel ordre. Comme
 * dans Blender, une correspondance garde ses ancêtres visibles et dépliés ;
 * son propre contenu reste accessible, mais replié.
 */
export function filterOutline(outline: ModelOutline, query: string): OutlineFilter {
  const words = normalizeName(query).split(' ').filter(Boolean);
  const matches = new Set<number>();
  const expand = new Set<number>();
  if (!words.length) return { visible: null, expand, matches };

  const visible = new Set<number>();
  for (const n of outline.byRank) {
    const name = normalizeName(n.name);
    if (!words.every((w) => name.includes(w))) continue;
    matches.add(n.rank);
    visible.add(n.rank);
    for (let p = n.parent; p; p = p.parent) {
      if (expand.has(p.rank)) break;
      expand.add(p.rank);
      visible.add(p.rank);
    }
  }
  // Le contenu d'une correspondance reste affichable, sans être déplié.
  const addSubtree = (n: OutlineNode) => {
    for (const c of n.children) { visible.add(c.rank); addSubtree(c); }
  };
  for (const r of matches) addSubtree(outline.byRank[r]);
  return { visible, expand, matches };
}

// ── Position d'un ouvrant dans l'arborescence ─────────────────────────────────

/**
 * Où se trouve un ouvrant : le nœud qu'il anime (`selected`, `null` pour la
 * pièce cliquée) et la maille de son clic d'origine (`seed`).
 *
 * Même règle que la carte : le rang tranche si le nom concorde, sinon le nom.
 */
export function locatePart(
  outline: ModelOutline,
  cfg: { mesh: string; meshIndex?: number; node?: string; nodeIndex?: number },
): { selected: number | null; seed: OutlineNode | null } {
  const seedByRank = cfg.meshIndex !== undefined && cfg.meshIndex >= 0
    ? outline.byRank.find((n) => n.meshRank === cfg.meshIndex)
    : undefined;
  const seed = (seedByRank && seedByRank.name === cfg.mesh ? seedByRank : undefined)
    ?? outline.byRank.find((n) => n.meshRank >= 0 && n.name === cfg.mesh)
    ?? null;
  let selected: number | null = null;
  if (cfg.node) {
    const byRank = cfg.nodeIndex !== undefined ? outline.byRank[cfg.nodeIndex] : undefined;
    selected = (byRank && byRank.name === cfg.node ? byRank : outline.byRank.find((n) => n.name === cfg.node))?.rank ?? null;
  }
  return { selected, seed };
}

/**
 * Nœuds à déplier pour montrer la cible d'un ouvrant : les ancêtres de la
 * sélection, et ceux de la maille cliquée — dépliée elle aussi, puisque la
 * pièce cliquée s'affiche sous elle.
 */
export function revealRanks(
  outline: ModelOutline,
  loc: { selected: number | null; seed: OutlineNode | null },
): number[] {
  const out = new Set<number>();
  if (loc.seed) {
    for (const a of ancestorsOf(outline, loc.seed.rank)) out.add(a);
    out.add(loc.seed.rank);
  }
  if (loc.selected !== null) for (const a of ancestorsOf(outline, loc.selected)) out.add(a);
  return [...out];
}

/** Rang de la ligne virtuelle « pièce cliquée », sous sa maille. */
export const PIECE_ROW = -1;

export interface OutlineRow {
  /** Rang du nœud, ou `PIECE_ROW`. */
  rank: number;
  node: OutlineNode | null;
  depth: number;
  hasKids: boolean;
  open: boolean;
}

/**
 * Toutes les lignes affichables, dans l'ordre, sans plafond.
 *
 * La liste ne contient que des références : même pour des milliers de nœuds
 * elle se calcule en un instant. C'est le dessin qui coûte, et l'arborescence
 * n'en dessine que la fenêtre visible. Un plafond sur la liste elle-même
 * rendait inatteignable tout objet au-delà — la plupart des portes d'un export
 * Blender, rangées après des centaines de murs.
 */
export function outlineRows(
  outline: ModelOutline,
  expanded: ReadonlySet<number>,
  filter: OutlineFilter,
  seed: OutlineNode | null = null,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (list: OutlineNode[], depth: number) => {
    for (const n of list) {
      if (filter.visible && !filter.visible.has(n.rank)) continue;
      const hasKids = n.children.length > 0 || n === seed;
      const open = hasKids && (expanded.has(n.rank) || filter.expand.has(n.rank));
      rows.push({ rank: n.rank, node: n, depth, hasKids, open });
      if (!open) continue;
      if (n === seed) rows.push({ rank: PIECE_ROW, node: null, depth: depth + 1, hasKids: false, open: false });
      walk(n.children, depth + 1);
    }
  };
  walk(outline.roots, 0);
  return rows;
}

/**
 * Premier indice de la fenêtre à dessiner pour centrer une ligne.
 *
 * Borné pour que la dernière ligne reste au bas de la liste, sans vide.
 */
export function centredScrollTop(index: number, rowHeight: number, viewport: number, total: number): number {
  const max = Math.max(0, total * rowHeight - viewport);
  return Math.min(max, Math.max(0, index * rowHeight - (viewport - rowHeight) / 2));
}

/** Ancêtres d'un nœud, du plus proche au plus lointain. */
export function ancestorsOf(outline: ModelOutline, rank: number): number[] {
  const out: number[] = [];
  for (let p = outline.byRank[rank]?.parent; p; p = p.parent) out.push(p.rank);
  return out;
}
