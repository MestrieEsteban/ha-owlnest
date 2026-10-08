/**
 * sh3d.ts — retrouver les ouvrants dans un export Sweet Home 3D.
 *
 * Sweet Home 3D anime ses portes et fenêtres d'après le nom des groupes de
 * leur modèle : `sweethome3d_hinge_1` porte l'axe du premier vantail,
 * `sweethome3d_opening_on_hinge_1_…` tout ce qui tourne autour (vantail,
 * poignée, vitre). Même chose avec `rail` pour un coulissant. L'export OBJ
 * garde ces noms, mais à plat : rien ne dit où finit un meuble et où commence
 * le suivant, et la numérotation repart de 1 pour chacun.
 *
 * On reconstitue donc les meubles d'après l'ordre des groupes : l'export écrit
 * chaque meuble d'un seul tenant, et un groupe sans préfixe (le cadre, le
 * meuble suivant) referme le précédent.
 */

export type Sh3dMotion = 'hinge' | 'rail';

export interface Sh3dLeaf {
  /** Rang du meuble dans l'export : deux vantaux d'une même fenêtre le partagent. */
  piece: number;
  /** Numéro du vantail dans son meuble (le N de `hinge_N`). */
  n: number;
  motion: Sh3dMotion;
  /** Groupes qui bougent : vantail, poignée, vitre. */
  moving: number[];
  /** Groupes qui portent l'axe : les gonds, ou le rail. */
  axis: number[];
  /** Un vantail vitré (`window_pane_on_…`) : une fenêtre plutôt qu'une porte. */
  pane: boolean;
}

const AXIS = /^sweethome3d_(hinge|rail)_(\d+)(?:_|$)/;
const MOVING = /^sweethome3d_(opening|window_pane)_on_(hinge|rail)_(\d+)(?:_|$)/;

export function sh3dLeaves(names: readonly string[]): Sh3dLeaf[] {
  const leaves: Sh3dLeaf[] = [];
  let piece = -1;
  let inPiece = false;
  let current = new Map<string, Sh3dLeaf>();

  const leafOf = (motion: Sh3dMotion, n: number): Sh3dLeaf => {
    const key = `${motion}_${n}`;
    let leaf = current.get(key);
    if (!leaf) {
      leaf = { piece, n, motion, moving: [], axis: [], pane: false };
      current.set(key, leaf);
      leaves.push(leaf);
    }
    return leaf;
  };
  const openPiece = () => {
    piece++;
    inPiece = true;
    current = new Map();
  };

  names.forEach((name, i) => {
    const axis = AXIS.exec(name);
    const moving = axis ? null : MOVING.exec(name);
    if (!axis && !moving) {
      // Un autre groupe Sweet Home 3D (miroir, vitre fixe) reste dans le meuble ;
      // tout le reste le referme.
      if (!name.startsWith('sweethome3d_')) inPiece = false;
      return;
    }
    if (axis) {
      const motion = axis[1] as Sh3dMotion;
      const n = Number(axis[2]);
      // Des gonds après le vantail qu'ils portent : c'est le meuble suivant,
      // collé au précédent sans groupe intermédiaire.
      if (!inPiece || (current.get(`${motion}_${n}`)?.moving.length ?? 0) > 0) openPiece();
      leafOf(motion, n).axis.push(i);
    } else if (moving) {
      if (!inPiece) openPiece();
      const leaf = leafOf(moving[2] as Sh3dMotion, Number(moving[3]));
      leaf.moving.push(i);
      if (moving[1] === 'window_pane') leaf.pane = true;
    }
  });

  // Sans pièce mobile, ou sans axe, il n'y a rien à animer de façon sûre.
  return leaves.filter((l) => l.moving.length > 0 && l.axis.length > 0);
}

export type Box = { min: [number, number, number]; max: [number, number, number] };

/**
 * Côté des gonds, dans la convention du moteur d'ouvrants (voir `partFrame`
 * et `hingePivot`) : la pièce se repère par ses axes triés du plus long au
 * plus court, et le côté se lit le long du deuxième, la largeur du vantail.
 */
export function hingeSide(leaf: Box, axis: Box): 'start' | 'end' {
  const size = [0, 1, 2].map((k) => leaf.max[k] - leaf.min[k]);
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a]);
  const wide = order[1];
  const c = (axis.min[wide] + axis.max[wide]) / 2;
  return c - leaf.min[wide] <= leaf.max[wide] - c ? 'start' : 'end';
}

/** Boîte englobante d'une liste de positions (x, y, z à plat). */
export function boxOf(positions: Iterable<ArrayLike<number>>): Box | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const pos of positions) {
    for (let i = 0; i + 2 < pos.length; i += 3) {
      any = true;
      for (let k = 0; k < 3; k++) {
        const v = pos[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
  }
  return any ? { min, max } : null;
}

/** Ce que l'import inscrit dans les `extras` du nœud d'un vantail. */
export interface Sh3dLeafExtras {
  owlnestLeaf: {
    motion: Sh3dMotion;
    hinge: 'start' | 'end';
    pane: boolean;
    /** Taille du vantail du plus grand axe au plus petit, en unités du modèle. */
    size: [number, number, number];
  };
}

/** Préfixe des nœuds de vantail créés à l'import : `sweethome3d_leaf_<meuble>_<n>`. */
export const LEAF_PREFIX = 'sweethome3d_leaf_';
