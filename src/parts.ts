/**
 * parts.ts — retrouver les objets d'origine d'un modèle fusionné.
 *
 * Un export « une seule maille » n'est pas un bloc monolithique : fusionner des
 * maillages concatène les tampons sans souder les sommets. Les triangles d'une
 * porte restent donc un îlot isolé, sans arête commune avec le mur qui la
 * porte. On récupère ces îlots par composantes connexes, ce qui rend chaque
 * porte, fenêtre ou volet sélectionnable sans retoucher le fichier.
 *
 * Le coût (~100 ms pour 100 000 triangles) est payé une fois dans l'éditeur :
 * la scène ne mémorise qu'un triangle d'amorce par ouvrant, et l'exécution se
 * contente de le retrouver. La tablette murale ne recalcule rien.
 */
import * as THREE from 'three';

// ── Index des pièces ────────────────────────────────────────────────────────

export interface MeshPart {
  /** Rang de la pièce dans le maillage, par nombre de triangles décroissant. */
  id: number;
  /** Indices de triangles (et non de sommets) appartenant à la pièce. */
  tris: Uint32Array;
  /** Boîte englobante dans l'espace local du maillage. */
  box: THREE.Box3;
}

export interface PartIndex {
  parts: MeshPart[];
  /** triangle → rang de sa pièce. */
  ofTriangle: Int32Array;
  triangleCount: number;
}

/** Union-find avec compression de chemin. */
class UnionFind {
  private p: Int32Array;
  constructor(n: number) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(x: number): number {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]];
      x = this.p[x];
    }
    return x;
  }
  union(a: number, b: number) {
    a = this.find(a);
    b = this.find(b);
    if (a !== b) this.p[a] = b;
  }
}

/**
 * Partitionne une géométrie en composantes connexes.
 *
 * La soudure se fait par position quantifiée, pas par indice de sommet : un
 * export duplique les sommets le long des coutures d'UV, ce qui découperait un
 * même objet en dizaines de morceaux si on suivait les indices.
 *
 * @param quantum Pas de quantification, dans l'unité du modèle. La valeur par
 *   défaut convient à un modèle en centimètres comme en mètres : elle ne sert
 *   qu'à rapprocher des sommets qui devraient être identiques.
 */
export function buildPartIndex(geom: THREE.BufferGeometry, quantum = 1e-4): PartIndex {
  const pos = geom.getAttribute('position');
  const index = geom.getIndex();
  const nv = pos.count;
  const triangleCount = (index ? index.count : nv) / 3 | 0;

  // Soudure : chaque position ne retient que son premier sommet représentant.
  const inv = 1 / quantum;
  const weld = new Int32Array(nv);
  const seen = new Map<string, number>();
  for (let v = 0; v < nv; v++) {
    const key = `${Math.round(pos.getX(v) * inv)},${Math.round(pos.getY(v) * inv)},${Math.round(pos.getZ(v) * inv)}`;
    const prev = seen.get(key);
    if (prev === undefined) {
      seen.set(key, v);
      weld[v] = v;
    } else {
      weld[v] = prev;
    }
  }

  const vertexOf = (tri: number, corner: number) =>
    index ? index.getX(tri * 3 + corner) : tri * 3 + corner;

  const uf = new UnionFind(nv);
  for (let t = 0; t < triangleCount; t++) {
    const a = weld[vertexOf(t, 0)];
    const b = weld[vertexOf(t, 1)];
    const c = weld[vertexOf(t, 2)];
    uf.union(a, b);
    uf.union(b, c);
  }

  // Regroupement des triangles par racine.
  const buckets = new Map<number, number[]>();
  for (let t = 0; t < triangleCount; t++) {
    const root = uf.find(weld[vertexOf(t, 0)]);
    let list = buckets.get(root);
    if (!list) buckets.set(root, (list = []));
    list.push(t);
  }

  const ordered = [...buckets.values()].sort((a, b) => b.length - a.length);
  const ofTriangle = new Int32Array(triangleCount).fill(-1);
  const parts: MeshPart[] = ordered.map((tris, id) => {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const t of tris) {
      ofTriangle[t] = id;
      for (let c = 0; c < 3; c++) {
        const vi = vertexOf(t, c);
        box.expandByPoint(v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)));
      }
    }
    return { id, tris: Uint32Array.from(tris), box };
  });

  return { parts, ofTriangle, triangleCount };
}

/**
 * Index mémorisé sur le maillage.
 *
 * Le calcul est trop coûteux pour être refait à chaque clic de l'éditeur, et
 * trop volumineux pour être stocké dans la scène.
 */
export function partIndexOf(mesh: THREE.Mesh): PartIndex {
  const cached = mesh.userData.__owlnestParts as PartIndex | undefined;
  if (cached) return cached;
  const built = buildPartIndex(mesh.geometry);
  mesh.userData.__owlnestParts = built;
  return built;
}

// ── Repère d'un ouvrant ─────────────────────────────────────────────────────

/** Axes locaux d'une pièce, déduits de ses proportions. */
export interface PartFrame {
  /** Axe le plus long : la hauteur d'une porte, donc son axe de rotation. */
  up: 0 | 1 | 2;
  /** Axe le plus long des deux restants : la largeur du vantail. */
  wide: 0 | 1 | 2;
  /** Axe le plus court : l'épaisseur. */
  thin: 0 | 1 | 2;
  size: [number, number, number];
}

/**
 * Déduit les axes d'un ouvrant de sa boîte englobante.
 *
 * On ne présume aucune orientation du modèle. Certains exports sont en Z-up,
 * d'autres en Y-up, et un ouvrant peut être posé dans n'importe quel sens :
 * lire les proportions est plus fiable que de coder un axe en dur.
 */
export function partFrame(box: THREE.Box3): PartFrame {
  const s = box.getSize(new THREE.Vector3());
  const size: [number, number, number] = [s.x, s.y, s.z];
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a]) as [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
  return { up: order[0], wide: order[1], thin: order[2], size };
}

/** Côté du vantail portant les gonds. */
export type HingeSide = 'start' | 'end';

/**
 * Position du gond : sur l'arête verticale choisie, au milieu de l'épaisseur.
 *
 * Faire pivoter un vantail autour de son centre le ferait traverser le mur —
 * c'est le défaut classique quand on anime un objet sans déplacer son pivot.
 */
export function hingePivot(box: THREE.Box3, frame: PartFrame, side: HingeSide): THREE.Vector3 {
  const min = [box.min.x, box.min.y, box.min.z];
  const max = [box.max.x, box.max.y, box.max.z];
  const p: [number, number, number] = [0, 0, 0];
  p[frame.up] = min[frame.up];
  p[frame.wide] = side === 'start' ? min[frame.wide] : max[frame.wide];
  p[frame.thin] = (min[frame.thin] + max[frame.thin]) / 2;
  return new THREE.Vector3(p[0], p[1], p[2]);
}

const AXIS_NAME = ['x', 'y', 'z'] as const;
export const axisName = (a: 0 | 1 | 2) => AXIS_NAME[a];

// ── Extraction ──────────────────────────────────────────────────────────────

export interface ExtractedPart {
  /** Maille indépendante, pivot à l'origine, enfant de la maille d'origine. */
  mesh: THREE.Mesh;
  frame: PartFrame;
  pivot: THREE.Vector3;
}

/**
 * Détache une pièce en maille autonome et la retire de la maille d'origine.
 *
 * Le retrait est indispensable : sans lui, le vantail s'ouvrirait en laissant
 * sa copie immobile dans l'embrasure.
 *
 * La nouvelle maille devient enfant de l'ancienne pour hériter de sa
 * transformation — inutile de recalculer une matrice monde.
 */
export function extractPart(
  mesh: THREE.Mesh,
  part: MeshPart,
  side: HingeSide = 'start',
): ExtractedPart {
  const geom = mesh.geometry;
  const index = geom.getIndex();
  const vertexOf = (tri: number, corner: number) =>
    index ? index.getX(tri * 3 + corner) : tri * 3 + corner;

  const frame = partFrame(part.box);
  const pivot = hingePivot(part.box, frame, side);

  // ── Géométrie détachée, exprimée par rapport au gond ──────────────────────
  const src = geom.attributes as Record<string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute>;
  const names = Object.keys(src);
  const out = new THREE.BufferGeometry();
  const n = part.tris.length * 3;

  for (const name of names) {
    const a = src[name];
    const itemSize = a.itemSize;
    const dst = new Float32Array(n * itemSize);
    let w = 0;
    for (const t of part.tris) {
      for (let c = 0; c < 3; c++) {
        const vi = vertexOf(t, c);
        for (let k = 0; k < itemSize; k++) {
          let value = a.getComponent(vi, k);
          // Seules les positions se déplacent : décaler une normale ou une UV
          // les corromprait.
          if (name === 'position') value -= pivot.getComponent(k);
          dst[w++] = value;
        }
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(dst, itemSize));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();

  const detached = new THREE.Mesh(out, mesh.material);
  detached.position.copy(pivot);
  detached.castShadow = mesh.castShadow;
  detached.receiveShadow = mesh.receiveShadow;
  detached.name = `${mesh.name || 'part'}#${part.id}`;
  mesh.add(detached);

  removeTriangles(mesh, part.tris);

  return { mesh: detached, frame, pivot };
}

/**
 * Retire des triangles d'une géométrie en réécrivant son index.
 *
 * Les attributs de sommets sont laissés en place : les sommets orphelins ne
 * coûtent que de la mémoire, alors que les renuméroter obligerait à réécrire
 * tous les attributs pour un gain nul à l'affichage.
 */
export function removeTriangles(mesh: THREE.Mesh, tris: ArrayLike<number>) {
  const geom = mesh.geometry;
  const index = geom.getIndex();
  const drop = new Set<number>();
  for (let i = 0; i < tris.length; i++) drop.add(tris[i]);

  if (index) {
    const total = index.count / 3 | 0;
    const kept = new Uint32Array((total - drop.size) * 3);
    let w = 0;
    for (let t = 0; t < total; t++) {
      if (drop.has(t)) continue;
      kept[w++] = index.getX(t * 3);
      kept[w++] = index.getX(t * 3 + 1);
      kept[w++] = index.getX(t * 3 + 2);
    }
    geom.setIndex(new THREE.BufferAttribute(kept, 1));
  } else {
    // Géométrie non indexée : on en fabrique un index plutôt que de recopier
    // tous les attributs.
    const total = geom.getAttribute('position').count / 3 | 0;
    const kept = new Uint32Array((total - drop.size) * 3);
    let w = 0;
    for (let t = 0; t < total; t++) {
      if (drop.has(t)) continue;
      kept[w++] = t * 3;
      kept[w++] = t * 3 + 1;
      kept[w++] = t * 3 + 2;
    }
    geom.setIndex(new THREE.BufferAttribute(kept, 1));
  }
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
}

// ── Reconnaissance ──────────────────────────────────────────────────────────

export type PartGuess = 'door' | 'window' | 'other';

/**
 * Devine la nature d'une pièce d'après ses dimensions, en centimètres.
 *
 * Sert uniquement à préremplir le formulaire : l'utilisateur clique la pièce
 * qu'il veut, la reconnaissance ne filtre rien.
 */
export function guessPart(box: THREE.Box3, unitToCm = 1): PartGuess {
  const f = partFrame(box);
  const height = f.size[f.up] * unitToCm;
  const width = f.size[f.wide] * unitToCm;
  const depth = f.size[f.thin] * unitToCm;
  if (depth > 35) return 'other';
  if (height > 170 && height < 235 && width > 55 && width < 130) return 'door';
  if (height > 50 && height < 170 && width > 35 && width < 260) return 'window';
  return 'other';
}
