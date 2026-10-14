/**
 * plan/types.ts — un logement dessiné dans la carte.
 *
 * Le plan est la source : la 3D se reconstruit à partir de lui à chaque
 * chargement et en direct pendant qu'on dessine. On garde des intentions
 * (« un mur d'ici à là », « une porte de 90 cm sur ce mur »), jamais des
 * triangles : un plan reste éditable, et pèse quelques kilo-octets.
 *
 * Comme sur un vrai plan d'architecte, le dessin est un réseau de murs : des
 * coins (`nodes`) reliés par des murs (`walls`). Les pièces ne sont pas
 * dessinées, elles sont déduites : tout espace fermé par des murs en est une.
 * Une pièce ne garde que ce qu'on ne peut pas deviner (nom, sol), et un point
 * qui dit laquelle elle est (`seed`).
 *
 * Unités : mètres. Repère de dessin vu de dessus : `x` vers la droite, `y`
 * vers le bas de l'écran ; en 3D, `y` devient la profondeur.
 */

export interface PlanNode {
  id: string;
  x: number;
  y: number;
}

export interface PlanWall {
  id: string;
  /** Coins de départ et d'arrivée. */
  a: string;
  b: string;
  /** Réglages propres à ce mur ; absents, ceux du plan. */
  thickness?: number;
  height?: number;
}

export interface PlanRoom {
  id: string;
  name: string;
  /** Couleur du sol, `#rrggbb`. */
  floor?: string;
  /** Matière du sol ; un aplat sans elle. */
  floorMaterial?: FloorMaterial;
  /** Couleur des murs vus depuis la pièce. */
  wall?: string;
  /** Un point à l'intérieur : la pièce est l'espace fermé qui le contient. */
  seed: { x: number; y: number };
}

export type OpeningKind = 'door' | 'window' | 'slider' | 'passage';

export type FloorMaterial = 'plain' | 'wood' | 'tiles' | 'concrete' | 'carpet';
/** Les matières de façade : enduit lisse, crépi, brique, bardage bois, pierre. */
export type FacadeMaterial = 'smooth' | 'render' | 'brick' | 'wood' | 'stone';

/** Modèles de porte et de fenêtre. */
export type DoorStyle = 'plain' | 'panels' | 'glazed' | 'entry';
export type WindowStyle = 'plain' | 'grid';

export interface PlanOpening {
  id: string;
  kind: OpeningKind;
  wall: string;
  /** Milieu de l'ouverture, en mètres depuis le coin de départ du mur. */
  offset: number;
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
  /** Modèle : `DoorStyle` pour une porte, `WindowStyle` pour une fenêtre ou une baie. */
  style?: DoorStyle | WindowStyle;
  /** Couleur du vantail (porte) ou du cadre (fenêtre, baie). */
  color?: string;
}

/** Un meuble posé sur le plan. */
export interface PlanItem {
  id: string;
  /** Identifiant du catalogue (`bedDouble`), ou adresse d'un modèle importé. */
  model: string;
  /** Centre de l'emprise au sol, en mètres. */
  x: number;
  y: number;
  /** Rotation en degrés, dans le sens des aiguilles d'une montre vu de dessus. */
  rotation: number;
  /**
   * Hauteur du bas du meuble. Absente, elle est déduite : au mur ou au
   * plafond selon le catalogue, sur le meuble du dessous pour une lampe ou un
   * objet posé, sinon au sol.
   */
  elevation?: number;
  /** Agrandissement par rapport à la taille du catalogue (anciens plans ; `size` le remplace). */
  scale?: number;
  /** Taille voulue en mètres : largeur, profondeur, hauteur. Absente, celle du modèle. */
  size?: [number, number, number];
  /** Couleur par matière du modèle : `carpet` (tissu), `wood`… */
  colors?: Record<string, string>;
  /** Pour une lampe : l'entité qu'elle représente. */
  entity?: string;
  name?: string;
}

/** Image de plan posée sous le dessin, pour le calquer. */
/** La forme d'un escalier : droit, en L (quart tournant), en U (demi-tournant), en colimaçon. */
export type StairShape = 'straight' | 'l' | 'u' | 'spiral';

/** Un escalier, posé sur ce niveau : il monte jusqu'au suivant. */
export interface PlanStair {
  id: string;
  /** Le milieu de l'escalier, vu de dessus. */
  x: number;
  y: number;
  /** Le sens de départ, en degrés : 0 part vers les x croissants. */
  rotation: number;
  /** Largeur d'une volée ; pour un colimaçon, son rayon. */
  width: number;
  /** Absente : droit. */
  shape?: StairShape;
  /** Le côté où il tourne (L, U, colimaçon). Absent : à droite. */
  turn?: 'left' | 'right';
  /** Douce, normale (absente) ou raide : la profondeur des marches, donc la longueur. */
  slope?: 'gentle' | 'steep';
}

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
  version: 2;
  wallHeight: number;
  wallThickness: number;
  nodes: PlanNode[];
  walls: PlanWall[];
  rooms: PlanRoom[];
  openings: PlanOpening[];
  /** Les meubles, absents d'un plan qui n'en a jamais eu. */
  items?: PlanItem[];
  /** Les escaliers qui partent de ce niveau. */
  stairs?: PlanStair[];
  /** Meubles importés par l'utilisateur, proposés dans « Mes meubles ». */
  library?: { url: string; name: string }[];
  background?: PlanBackground;
  /** Couleur des murs côté extérieur. */
  outside?: string;
  /** Matière des façades (enduit lisse par défaut). */
  facade?: FacadeMaterial;
  /** Une bande plus sombre au pied des façades. */
  plinth?: boolean;
  /** Toit du dernier niveau : plat (absent) ou en pente, vu murs debout. */
  roof?: 'hip';
  /** Couverture du toit en pente. Absente : tuile. */
  roofColor?: 'tile' | 'slate' | 'zinc';
  /**
   * Point du plan placé au centre de la scène 3D. Fixé au premier dessin et
   * plus jamais recalculé : les ancres sont posées en coordonnées de la scène,
   * et ne doivent pas glisser quand on agrandit la maison.
   */
  origin?: { x: number; y: number };
  /**
   * Les étages au-dessus du rez-de-chaussée (voir floors.ts). Absent : une
   * maison de plain-pied, comme tous les plans d'avant les étages.
   */
  floors?: PlanFloor[];
  /** Nom du rez-de-chaussée, quand l'utilisateur l'a changé. */
  groundName?: string;
}

/** Un étage : son plan, et la hauteur de son sol au-dessus du rez-de-chaussée. */
export interface PlanFloor {
  id: string;
  name: string;
  /** En mètres, au-dessus du sol du rez-de-chaussée. */
  elevation: number;
  doc: PlanDoc;
}

export function emptyPlan(): PlanDoc {
  return { version: 2, wallHeight: 2.5, wallThickness: 0.15, nodes: [], walls: [], rooms: [], openings: [] };
}

/** Dimensions par défaut d'une nouvelle ouverture, en mètres. */
export const OPENING_DEFAULTS: Record<OpeningKind, Pick<PlanOpening, 'width' | 'height' | 'sill'>> = {
  door: { width: 0.83, height: 2.04, sill: 0 },
  window: { width: 1.2, height: 1.25, sill: 0.9 },
  slider: { width: 2.2, height: 2.15, sill: 0 },
  passage: { width: 0.9, height: 2.1, sill: 0 },
};

/** Couleurs par défaut. */
export const PLAN_COLORS = {
  wall: '#ece8e1',
  outside: '#e4ddd0',
  door: '#c8a77e',
  frame: '#f4f4f2',
};
