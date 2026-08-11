/**
 * coplanar.ts — sépare les surfaces horizontales strictement confondues.
 *
 * Un export Sweet Home 3D empile plusieurs dalles à la même altitude : son
 * terrain, le sol de chaque pièce, et le dessous des tapis. Deux plans
 * rigoureusement coplanaires ne peuvent pas être départagés par une carte de
 * profondeur, quelle que soit sa précision : le rendu bascule de l'un à l'autre
 * selon l'angle de vue. C'est le scintillement bien connu sous le nom de
 * z-fighting.
 *
 * On ne supprime rien. Le terrain déborde du sol de la pièce — chez un modèle
 * réel, 601 × 618 cm contre 585 × 597 —, donc l'effacer laisserait un trou
 * visible. On se contente de décaler les dalles supérieures d'une fraction
 * imperceptible, dans l'ordre naturel : le plus large en dessous, le plus
 * étroit au-dessus.
 *
 * Le décalage est relatif à l'envergure du modèle : un écart fixe en unités
 * serait invisible sur un modèle en centimètres et énorme sur un modèle en
 * mètres.
 */
import * as THREE from 'three';

/** Une dalle candidate : sa boîte englobante suffit à décider. */
export interface Slab {
  /** Identifiant opaque, rendu tel quel dans le résultat. */
  id: number;
  box: THREE.Box3;
}

export interface SlabLift {
  id: number;
  /** Décalage vertical à appliquer, dans l'unité du modèle. */
  lift: number;
}

export interface CoplanarOptions {
  /** Envergure du modèle : sert d'échelle au seuil et au décalage. */
  span: number;
  /** Axe vertical du modèle (0=x, 1=y, 2=z). */
  vertical?: 0 | 1 | 2;
}

/** Les deux axes horizontaux, dans l'ordre, pour une verticale donnée. */
function planeAxes(vertical: 0 | 1 | 2): [0 | 1 | 2, 0 | 1 | 2] {
  return ([0, 1, 2] as const).filter((a) => a !== vertical) as [0 | 1 | 2, 0 | 1 | 2];
}

const comp = (v: THREE.Vector3, a: 0 | 1 | 2) => (a === 0 ? v.x : a === 1 ? v.y : v.z);

/**
 * Calcule les décalages à appliquer pour lever toute coplanarité.
 *
 * Fonction pure : elle ne touche à aucun objet de la scène, ce qui la rend
 * testable et permet d'en vérifier l'effet avant de l'appliquer.
 *
 * @returns Un décalage par dalle concernée. Les dalles absentes du résultat
 *   n'ont pas besoin d'être déplacées.
 */
export function resolveCoplanar(slabs: Slab[], opts: CoplanarOptions): SlabLift[] {
  const { span } = opts;
  const vertical = opts.vertical ?? 1;
  const [ax, az] = planeAxes(vertical);

  if (!(span > 0)) return [];

  // Une dalle est une surface : mince devant son emprise, et assez large pour
  // qu'un chevauchement se voie.
  const maxThickness = Math.max(span * 0.006, 1e-6);
  const minSide = span * 0.04;

  interface Cand extends Slab { base: number; area: number; }
  const cands: Cand[] = [];
  for (const s of slabs) {
    const size = s.box.getSize(new THREE.Vector3());
    const thickness = comp(size, vertical);
    const w = comp(size, ax);
    const d = comp(size, az);
    if (thickness > maxThickness) continue;
    if (w < minSide || d < minSide) continue;
    cands.push({ ...s, base: comp(s.box.min, vertical), area: w * d });
  }
  if (cands.length < 2) return [];

  // Regroupement par altitude d'assise. La tolérance absorbe le bruit d'un
  // export en virgule flottante sans rapprocher deux étages distincts.
  //
  // Elle doit rester nettement inférieure au pas de séparation : sinon deux
  // dalles qu'on vient d'écarter se retrouvent regroupées au passage suivant,
  // et la correction se croit inutile.
  const tol = Math.max(span * 4e-5, 1e-7);
  cands.sort((a, b) => a.base - b.base);

  const groups: Cand[][] = [];
  let currentGroup: Cand[] = [];
  let anchor = Number.NEGATIVE_INFINITY;
  for (const c of cands) {
    if (currentGroup.length === 0 || Math.abs(c.base - anchor) <= tol) {
      if (currentGroup.length === 0) anchor = c.base;
      currentGroup.push(c);
    } else {
      groups.push(currentGroup);
      currentGroup = [c];
      anchor = c.base;
    }
  }
  if (currentGroup.length) groups.push(currentGroup);

  const overlaps = (a: Cand, b: Cand) =>
    comp(a.box.min, ax) < comp(b.box.max, ax) && comp(b.box.min, ax) < comp(a.box.max, ax) &&
    comp(a.box.min, az) < comp(b.box.max, az) && comp(b.box.min, az) < comp(a.box.max, az);

  /**
   * Pas de séparation : deux millièmes de l'envergure, soit 1,2 cm sur un
   * modèle de 6 m.
   *
   * Il ne suffit pas d'être « non nul ». La profondeur d'un tampon 24 bits se
   * dégrade avec le carré de la distance : à 600 unités d'un plan de coupe
   * proche placé à 3 unités, on ne discrimine plus qu'au dixième d'unité. Un
   * écart inférieur laisserait le scintillement intact.
   *
   * À l'inverse il reste sous le seuil de perception : personne ne verra un sol
   * remonté d'un centimètre sur un appartement de six mètres.
   */
  const step = span * 2e-3;

  const out: SlabLift[] = [];
  for (const group of groups) {
    if (group.length < 2) continue;

    // La plus grande dalle reste en place et les autres montent : c'est l'ordre
    // physique — le terrain sous le sol, le sol sous le tapis.
    group.sort((a, b) => b.area - a.area);

    const placed: Cand[] = [group[0]];
    let rank = 0;
    for (let i = 1; i < group.length; i++) {
      const c = group[i];
      // Seul un chevauchement en plan provoque le conflit. Deux dalles côte à
      // côte à la même altitude n'ont aucune raison d'être déplacées.
      if (!placed.some((p) => overlaps(p, c))) continue;
      rank++;
      out.push({ id: c.id, lift: step * rank });
      placed.push(c);
    }
  }
  return out;
}

/**
 * Applique la séparation à un modèle chargé.
 *
 * Le décalage porte sur la position de l'objet, jamais sur sa géométrie : rien
 * n'est réécrit, et un rechargement repart d'un état propre.
 *
 * @returns Le nombre de dalles déplacées, pour information.
 */
export function separateCoplanarSlabs(
  root: THREE.Object3D,
  span: number,
  vertical: 0 | 1 | 2 = 1,
): number {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.__coplanarLifted) meshes.push(m);
  });

  const slabs: Slab[] = [];
  meshes.forEach((m, id) => {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const box = m.geometry.boundingBox;
    if (box) slabs.push({ id, box: box.clone() });
  });

  const lifts = resolveCoplanar(slabs, { span, vertical });
  const axis = (['x', 'y', 'z'] as const)[vertical];
  for (const { id, lift } of lifts) {
    const mesh = meshes[id];
    if (!mesh) continue;
    mesh.position[axis] += lift;
    mesh.userData.__coplanarLifted = lift;
  }
  return lifts.length;
}
