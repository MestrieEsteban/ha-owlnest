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

/**
 * Les ouvrants apparaissent-ils dans l'éditeur ?
 *
 * `false` masque l'onglet « Ouvrants ». Le reste continue de fonctionner : une
 * scène qui en contient déjà les anime normalement, et l'enregistrement les
 * préserve. Seule la création est retirée.
 *
 * La raison n'est pas technique — la fonctionnalité est testée et vérifiée sur
 * un modèle réel. Mais elle n'a jamais servi sur un vrai tableau de bord, et le
 * choix du côté des gonds demande encore du tâtonnement. On la garde pour une
 * version où elle aura été éprouvée.
 *
 * Même dispositif que `CARDS_ENABLED` : basculer à `true` la réactive.
 */
export const PARTS_ENABLED = true;

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
 * Arête portant les gonds : `axis` est l'axe de rotation, `across` l'axe le
 * long duquel on choisit le bord. Le troisième axe est l'épaisseur.
 */
export interface HingeEdge {
  axis: 0 | 1 | 2;
  across: 0 | 1 | 2;
}

/**
 * Position du gond : sur l'arête choisie, au milieu de l'épaisseur.
 *
 * Par défaut l'arête est verticale (porte) ; un abattant passe une arête
 * horizontale, bord pris le long de la verticale.
 *
 * Faire pivoter un vantail autour de son centre le ferait traverser le mur —
 * c'est le défaut classique quand on anime un objet sans déplacer son pivot.
 */
export function hingePivot(
  box: THREE.Box3,
  frame: PartFrame,
  side: HingeSide,
  edge: HingeEdge = { axis: frame.up, across: frame.wide },
): THREE.Vector3 {
  const min = [box.min.x, box.min.y, box.min.z];
  const max = [box.max.x, box.max.y, box.max.z];
  const depth = (3 - edge.axis - edge.across) as 0 | 1 | 2;
  const p: [number, number, number] = [0, 0, 0];
  p[edge.axis] = min[edge.axis];
  p[edge.across] = side === 'start' ? min[edge.across] : max[edge.across];
  p[depth] = (min[depth] + max[depth]) / 2;
  return new THREE.Vector3(p[0], p[1], p[2]);
}

/**
 * Axe vertical du modèle, déduit de ses proportions d'ensemble.
 *
 * Le repère d'une pièce ne suffit pas : `partFrame` prend le plus grand axe
 * pour la hauteur, ce qui est juste pour une porte mais faux pour un volet de
 * baie, plus large que haut — « coulisse vers le bas » le ferait glisser de
 * côté.
 *
 * Une maison est toujours plus étendue au sol qu'en hauteur, quelle que soit
 * la convention d'export. L'axe de plus **faible** étendue est donc la
 * verticale : Y sur un modèle Y-up (760 × 250 × 520), Z sur un modèle Z-up
 * (788 × 733 × 250).
 */
export function verticalAxis(modelBox: THREE.Box3): 0 | 1 | 2 {
  const s = modelBox.getSize(new THREE.Vector3());
  const size = [s.x, s.y, s.z];
  let best: 0 | 1 | 2 = 1;
  for (const a of [0, 1, 2] as const) if (size[a] < size[best]) best = a;
  return best;
}

const AXIS_NAME = ['x', 'y', 'z'] as const;
export const axisName = (a: 0 | 1 | 2) => AXIS_NAME[a];

// ── Extraction ──────────────────────────────────────────────────────────────

export interface ExtractedPart {
  /** Maille indépendante, pivot à l'origine, enfant de la maille d'origine. */
  mesh: THREE.Mesh;
  frame: PartFrame;
  pivot: THREE.Vector3;
  /** Index d'origine des triangles retirés, pour `restoreTriangles`. */
  saved: Uint32Array;
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

  const saved = removeTriangles(mesh, part.tris);

  return { mesh: detached, frame, pivot, saved };
}

/**
 * Retire des triangles d'une géométrie sans renuméroter les autres.
 *
 * Chaque triangle retiré devient dégénéré (ses trois coins sur un même
 * sommet) : il ne se dessine plus et le lancer de rayons l'ignore, mais sa
 * place dans l'index demeure. Compacter l'index décalait tous les triangles
 * suivants — le triangle d'amorce d'un second ouvrant de la même maille, ou
 * celui d'un clic, désignait alors une autre pièce.
 *
 * @returns Les indices d'origine, trois par triangle, pour `restoreTriangles`.
 */
export function removeTriangles(mesh: THREE.Mesh, tris: ArrayLike<number>): Uint32Array {
  const geom = mesh.geometry;
  let index = geom.getIndex();
  if (!index) {
    // Géométrie non indexée : on en fabrique un index plutôt que de recopier
    // tous les attributs.
    const n = geom.getAttribute('position').count;
    const seq = new Uint32Array(n);
    for (let i = 0; i < n; i++) seq[i] = i;
    index = new THREE.BufferAttribute(seq, 1);
    geom.setIndex(index);
  }
  const saved = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    for (let c = 0; c < 3; c++) saved[i * 3 + c] = index.getX(t * 3 + c);
    const a = saved[i * 3];
    index.setX(t * 3 + 1, a);
    index.setX(t * 3 + 2, a);
  }
  index.needsUpdate = true;
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return saved;
}

/** Rend à une géométrie les triangles retirés par `removeTriangles`. */
export function restoreTriangles(mesh: THREE.Mesh, tris: ArrayLike<number>, saved: ArrayLike<number>) {
  const index = mesh.geometry.getIndex();
  if (!index) return;
  for (let i = 0; i < tris.length; i++) {
    for (let c = 0; c < 3; c++) index.setX(tris[i] * 3 + c, saved[i * 3 + c]);
  }
  index.needsUpdate = true;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
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
