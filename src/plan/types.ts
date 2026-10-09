/**
 * plan/types.ts — un logement dessiné dans la carte.
 *
 * Le plan est la source : la 3D se reconstruit à partir de lui à chaque
 * chargement et en direct pendant qu'on dessine. On garde des intentions
 * (« une pièce de 4 × 3 m », « une porte de 90 cm sur ce mur »), jamais des
 * triangles : un plan reste éditable, et pèse quelques kilo-octets.
 *
 * Unités : mètres. Repère de dessin vu de dessus : `x` vers la droite, `y`
 * vers le bas de l'écran ; en 3D, `y` devient la profondeur et la hauteur
 * part vers le haut.
 */

export interface PlanRoom {
  id: string;
  name: string;
  /** Coin haut-gauche et taille, sur les lignes médianes des murs. */
  x: number;
  y: number;
  w: number;
  d: number;
  /** Couleur du sol, `#rrggbb`. */
  floor?: string;
}

export type OpeningKind = 'door' | 'window' | 'slider';

export interface PlanOpening {
  id: string;
  kind: OpeningKind;
  /** Milieu de l'ouverture, posé sur la ligne d'un mur. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Hauteur du bas de l'ouverture : 0 pour une porte, l'allège pour une fenêtre. */
  sill: number;
  /** Côté des gonds (ou de rangement d'un coulissant), le long du mur. */
  hinge: 'start' | 'end';
  /** Côté du mur vers lequel le battant s'ouvre. */
  swing: 'front' | 'back';
  /** Deux vantaux, pour une fenêtre ou une porte-fenêtre. */
  double?: boolean;
}

/** Réglages propres à un mur, retrouvé par son identifiant (voir walls.ts). */
export interface WallOverride {
  height?: number;
  thickness?: number;
}

/** Image de plan posée sous le dessin, pour le calquer. */
export interface PlanBackground {
  /** Image réduite, en data URL : elle voyage avec la scène. */
  src: string;
  x: number;
  y: number;
  /** Largeur de l'image, en mètres une fois mise à l'échelle. */
  width: number;
  /** Hauteur sur largeur de l'image d'origine. */
  aspect: number;
  opacity: number;
}

export interface PlanDoc {
  version: 1;
  wallHeight: number;
  wallThickness: number;
  rooms: PlanRoom[];
  openings: PlanOpening[];
  walls?: Record<string, WallOverride>;
  background?: PlanBackground;
  /**
   * Point du plan placé au centre de la scène 3D. Fixé au premier dessin et
   * plus jamais recalculé : les ancres sont posées en coordonnées de la scène,
   * et ne doivent pas glisser quand on agrandit la maison.
   */
  origin?: { x: number; y: number };
}

export function emptyPlan(): PlanDoc {
  return { version: 1, wallHeight: 2.5, wallThickness: 0.15, rooms: [], openings: [] };
}

/** Dimensions par défaut d'une nouvelle ouverture, en mètres. */
export const OPENING_DEFAULTS: Record<OpeningKind, Pick<PlanOpening, 'width' | 'height' | 'sill'>> = {
  door: { width: 0.83, height: 2.04, sill: 0 },
  window: { width: 1.2, height: 1.25, sill: 0.9 },
  slider: { width: 2.2, height: 2.15, sill: 0 },
};
