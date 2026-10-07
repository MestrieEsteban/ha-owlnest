import * as THREE from 'three';
export type { SceneCard, RoomCard, EntityCard, InfoCard, SceneCardType, SceneCardSize } from './cards/types';
export type { OwlnestRule, EntityCondition, Action, Trigger } from './rules/types';

export type EntityDomain =
  | 'light'
  | 'switch'
  | 'cover'
  | 'climate'
  | 'media_player'
  | 'sensor'
  | 'binary_sensor'
  | string;

export type LightStyle = 'point' | 'spot' | 'beam';

/**
 * Nature d'une ancre — orthogonale au domaine de l'entité.
 *
 * Les descripteurs (entities/descriptors.ts) disent *quoi* affiche une ancre
 * liée à une entité ; la nature dit *comment* elle se présente et ce que fait
 * un appui.
 *
 *   entity  pastille d'état classique, liée a une entite (defaut)
 *   label   texte ancre dans l'espace, sans entite
 *   menu    roue d'actions (scripts, scenes, appels de service, vues)
 *   nav     vole vers une vue camera enregistree
 *
 * Seule la nature `entity` exige un `entity` renseigne. Le champ reste de type
 * `string` et vaut une chaine vide pour les autres : le rendre optionnel
 * ferait remonter `string | undefined` dans une trentaine de sites sans rien
 * apporter, la nature suffisant a savoir s'il faut le lire.
 */
export type AnchorKind = 'entity' | 'label' | 'menu' | 'nav';

/** Une entree de la roue d'actions. */
export interface AnchorAction {
  id: string;
  label: string;
  icon?: string;
  /**
   *   entity   delegue tout au descripteur de l'entite ciblee : icone, couleur,
   *            valeur affichee et effet de l'appui (basculer une lampe, ouvrir
   *            la fiche d'un capteur). C'est le cas courant.
   *   service  appel de service explicite, pour ce que `entity` ne couvre pas.
   *   view     vol vers une vue camera.
   */
  type: 'entity' | 'service' | 'view';
  /** Nature `entity` : l'entite representee. */
  entity_id?: string;
  domain?: string;
  service?: string;
  service_data?: Record<string, unknown>;
  view_id?: string;
}

export interface HassState {
  state: string;
  attributes: Record<string, unknown>;
}

export interface Hass {
  states: Record<string, HassState>;
  callService(domain: string, service: string, data: Record<string, unknown>): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callWS<T = unknown>(msg: Record<string, unknown>): Promise<T>;
  /**
   * Registres exposés directement par les versions récentes du frontend HA.
   * Absents sur les versions plus anciennes : voir entities/registry.ts, qui
   * bascule alors sur les commandes WebSocket équivalentes.
   */
  /**
   * Langue du frontend, telle que Home Assistant l'expose.
   *
   * `language` est une etiquette BCP 47 (`fr`, `fr-FR`, `pt-BR`). `locale` est
   * la forme structuree des versions recentes ; on lit les deux, la premiere
   * presente gagne.
   */
  language?: string;
  locale?: { language?: string };
  areas?: Record<string, unknown>;
  devices?: Record<string, unknown>;
  entities?: Record<string, unknown>;
  floors?: Record<string, unknown>;
}

/** Named camera preset — saved in OwlnestScene.camera_views */
export interface CameraView {
  id?: string;                         // Stable identifier (auto-generated if absent)
  label: string;
  position: [number, number, number];
  target: [number, number, number];    // Always required (defaults [0,0,0] on old data)
  hidden?: boolean;                    // When true: available for rules/fly-to but hidden from HUD
}

/** Anchor config stored in YAML (legacy) or derived from an OwlnestScene */
export interface AnchorConfig {
  entity: string;
  position: [number, number, number];
  label?: string;
  hidden?: boolean;
  lightStyle?: LightStyle;
  lightIntensity?: number;
  lightDirection?: [number, number, number];
  visibleIf?: import('./rules/types').EntityCondition;
  precision?: number;   // decimal places for sensor display (e.g. 0 → "18", 1 → "17.6")
  icon?: string;        // override icon, e.g. "mdi:thermometer"
  /** Couleur d'etat imposee (#rrggbb) — surcharge celle du descripteur. */
  color?: string;
  /** Action au tap imposee — 'default' laisse decider le descripteur. */
  tapAction?: import('./entities/descriptors').TapAction | 'default';
  /** Nature de l'ancre — `entity` par defaut. */
  kind?: AnchorKind;
  /** Nature `menu` : les entrees de la roue. */
  actions?: AnchorAction[];
  /** Nature `nav` : identifiant de la vue camera cible. */
  navViewId?: string;
  /**
   * Multiplicateur de taille pour les overlays dimensionnes par la perspective
   * (vignettes de camera). 1 = taille de reference, deduite des dimensions du
   * modele.
   *
   * Volontairement relatif et non exprime en metres : un export Sweet Home 3D
   * peut etre en centimetres (une maison mesure alors 800 unites de large), et
   * l'utilisateur n'a pas a connaitre l'unite de son GLB.
   */
  size?: number;
  /**
   * Force la presentation d'une ancre d'entite. `auto` suit le descripteur —
   * une camera s'affiche donc en vignette par defaut, mais peut etre ramenee a
   * une simple pastille.
   */
  display?: 'auto' | 'icon' | 'thumbnail';
}

// ── Owlnest scene (backend-persisted) ─────────────────────────────────────

/** A single anchor as stored in an Owlnest scene */
export interface OwlnestAnchor {
  id: string;
  entity: string;
  label?: string;
  position: [number, number, number];
  visible?: boolean;
  variant?: string;
  lightStyle?: LightStyle;
  lightIntensity?: number;
  lightDirection?: [number, number, number];
  visibleIf?: import('./rules/types').EntityCondition; // show/hide overlay based on entity state
  precision?: number;
  icon?: string;
  /** Couleur d'etat imposee (#rrggbb) — surcharge celle du descripteur. */
  color?: string;
  /** Action au tap imposee — 'default' laisse decider le descripteur. */
  tapAction?: import('./entities/descriptors').TapAction | 'default';
  /** Nature de l'ancre — `entity` par defaut. */
  kind?: AnchorKind;
  /** Nature `menu` : les entrees de la roue. */
  actions?: AnchorAction[];
  /** Nature `nav` : identifiant de la vue camera cible. */
  navViewId?: string;
  /**
   * Multiplicateur de taille pour les overlays dimensionnes par la perspective
   * (vignettes de camera). 1 = taille de reference, deduite des dimensions du
   * modele.
   *
   * Volontairement relatif et non exprime en metres : un export Sweet Home 3D
   * peut etre en centimetres (une maison mesure alors 800 unites de large), et
   * l'utilisateur n'a pas a connaitre l'unite de son GLB.
   */
  size?: number;
  /**
   * Force la presentation d'une ancre d'entite. `auto` suit le descripteur —
   * une camera s'affiche donc en vignette par defaut, mais peut etre ramenee a
   * une simple pastille.
   */
  display?: 'auto' | 'icon' | 'thumbnail';
}

/** Scene-level settings stored in the backend (configured from edit mode, not YAML). */
export interface SceneSettings {
  sun_entity?: string;
  weather_entity?: string;
  language?: 'en' | 'fr';
  cluster_threshold?: number;
  orbit?: {
    min_distance?: number;
    max_distance?: number;
    max_polar_angle?: number;
  };
  rendering?: RenderingConfig;
}

export type SunMode = 'showcase' | 'realistic';
export type LightOcclusion = 'none' | 'top';
export type GroundStyle = 'square' | 'disc' | 'infinite' | 'podium' | 'none';

export interface RenderingConfig {
  exposure?: number;
  fog_density?: number;
  /**
   * Effacement de ce qui se trouve entre la caméra et le cœur du logement.
   *
   * 0 (défaut) : inactif. Au-delà, c'est la part du trajet caméra-centre sur
   * laquelle le fondu s'étale — à 0,5, tout ce qui est à moins de la moitié du
   * chemin a disparu.
   *
   * En tournant autour du modèle, le mur qui bouche la vue s'efface et se
   * reforme derrière. Le reste de la maison reste plein.
   */
  xray?: number;
  ground_color?: string;
  shadows?: boolean;
  transparent_background?: boolean;
  sky?: boolean;
  sun_intensity?: number;
  ambient_intensity?: number;
  /** Sun rendering mode: 'showcase' (free/pretty) or 'realistic' (physically oriented) */
  sun_mode?: SunMode;
  /** House orientation relative to north, in degrees (0 = model front faces north, 90 = east, etc.) */
  house_orientation?: number;
  /** Light occlusion to prevent sun from entering open-top models */
  light_occlusion?: LightOcclusion;
  /** Ground/base style */
  ground_style?: GroundStyle;
  /** Ground scale multiplier (default 1.0, range 0.5–3.0) */
  ground_scale?: number;
  /** Quality/performance preset — see quality.ts. 'auto' probes the hardware. */
  quality?: import('./quality').QualityLevel;
}

/** A full Owlnest scene, persisted by the backend integration. */
// ── Ouvrants ────────────────────────────────────────────────────────────────

/**
 * Battant (porte, fenêtre), coulissant (volet, baie, porte de garage) ou
 * déroulant (store banne, rideau) : ce dernier s'écrase vers une arête fixe.
 */
export type PartMotion = 'swing' | 'slide' | 'extend' | 'animation';

/**
 * Axe d'écrasement d'un déroulant, relatif au mur qui le porte.
 *
 * `out` sort du mur, incliné de `extendTilt` sous l'horizontale (store banne) ;
 * `vertical` descend le long du mur (store, rideau) ; `along` court le long du
 * mur (rideau qui se tire de côté).
 */
export type ExtendAxis = 'out' | 'vertical' | 'along';

/** Nœud du modèle désigné comme dans `OwlnestPart.node` / `nodeIndex`. */
export interface PartNodeRef {
  node: string;
  nodeIndex?: number;
}

/** Sens du coulissement, dans le repère propre à la pièce. */
export type SlideDirection = 'down' | 'up' | 'start' | 'end';

/**
 * Une pièce du modèle animée par l'état d'une entité.
 *
 * On ne mémorise pas la géométrie, seulement de quoi la retrouver : le nom de
 * la maille et un triangle lui appartenant. L'analyse en composantes connexes
 * a lieu dans l'éditeur, jamais sur la tablette.
 */
/** Une piece secondaire d'un ouvrant, designee par un clic. */
export interface PartPiece {
  mesh: string;
  meshIndex?: number;
  triangle: number;
  /** Ce que montrait le clic, pour nommer la ligne dans la liste. */
  label?: string;
}

export interface OwlnestPart {
  id: string;
  entity: string;
  /** Nom de la maille contenant la pièce, tel qu'exporté par le modeleur. */
  mesh: string;
  /**
   * Rang de la maille dans le parcours du modèle.
   *
   * Rien n'oblige un modeleur à donner des noms uniques : deux mailles
   * homonymes feraient animer la mauvaise porte. Le rang tranche, le nom reste
   * pour rester lisible et pour les scènes enregistrées avant ce champ.
   */
  meshIndex?: number;
  /** Triangle d'amorce : suffit à réidentifier la pièce entière. */
  triangle: number;
  /**
   * Nœud du modèle animé en entier — un objet ou un groupe Blender, avec tout
   * son contenu — à la place de la pièce désignée par `mesh` et `triangle`.
   * Ceux-ci restent enregistrés : c'est le clic d'origine, qui permet de
   * revenir à la pièce seule.
   */
  node?: string;
  /** Rang du nœud dans le graphe tel que chargé : départage les homonymes. */
  nodeIndex?: number;
  /**
   * Pieces choisies a la main qui bougent avec l'ouvrant.
   *
   * Un modeleur ne soude pas la poignee au vantail et ne les groupe pas : sur
   * un export plat, rien ne les relie. La geometrie seule ne tranche pas de
   * facon fiable — un clic, si.
   *
   * Chaque piece se designe comme l'ouvrant lui-meme : la maille, son rang, et
   * un triangle d'amorce qui suffit a retrouver la composante entiere.
   */
  extra?: PartPiece[];
  /**
   * Emmener les pieces contenues dans le volume de l'ouvrant.
   *
   * Une poignee n'est ni soudee au vantail ni groupee avec lui : sur un export
   * plat, rien dans le graphe ne les relie. La contenance le dit a leur place.
   * Absent vaut `true` ; `false` ne fait bouger que la piece designee.
   */
  carry?: boolean;
  /** Noms de pieces que l'utilisateur a retirees de l'entrainement. */
  carryExclude?: string[];
  label?: string;
  motion: PartMotion;
  /**
   * Axe de rotation d'un battant. Absent : vertical, comme une porte.
   * Horizontal : abattant (lave-vaisselle, four, fenêtre à soufflet) ; `hinge`
   * désigne alors le bas (`start`) ou le haut (`end`), selon la verticale du
   * modèle.
   */
  swingAxis?: 'vertical' | 'horizontal';
  /** Côté des gonds, pour un battant. */
  hinge?: 'start' | 'end';
  /**
   * Côté du mur vers lequel s'ouvre un battant.
   *
   * Le modèle ne dit pas où est l'intérieur : on ne peut qu'inverser le sens,
   * et l'aperçu montre lequel est le bon.
   */
  swingSide?: 'front' | 'back';
  /** Ouverture d'un battant, en degrés. */
  angle?: number;
  /** Sens de retrait d'un coulissant. */
  slide?: SlideDirection;
  /** Course d'un coulissant, en fraction de sa propre dimension. */
  travel?: number;
  /** Axe d'un déroulant. Absent : déduit de la géométrie de la toile. */
  extendAxis?: ExtendAxis;
  /**
   * Inclinaison de l'axe `out`, en degrés sous l'horizontale : 0 sort à plat,
   * 90 descend le long du mur. Absente : celle de la toile.
   */
  extendTilt?: number;
  /**
   * Arête fixe d'un déroulant : `start` côté mur (ou haut, ou début de l'axe
   * `along`), `end` à l'opposé. Absente : `start`.
   */
  extendAnchor?: 'start' | 'end';
  /** Échelle le long de l'axe quand l'entité est ouverte. Absente : 1, la pose du modèle. */
  extendOpen?: number;
  /** Échelle quand l'entité est fermée. Absente : 0 (bornée à un souffle, voir le runtime). */
  extendClosed?: number;
  /**
   * Objets qui suivent l'arête mobile d'un déroulant sans être déformés : la
   * barre de charge d'un store. Absent : ceux qui touchent l'arête mobile ;
   * vide : aucun.
   */
  followers?: PartNodeRef[];
  /**
   * Animations du fichier (pistes NLA de Blender) posées par l'entité : fermé
   * à leur première image clé, ouvert à la dernière. Toutes avancent ensemble.
   * `mesh`, `triangle` et `node` ne servent alors qu'à rouvrir l'ouvrant d'un
   * clic : rien n'est détaché.
   */
  clips?: string[];
  /**
   * États qui signifient « ouvert ».
   *
   * Vide, la lecture passe par le descripteur du domaine. Renseigné, il prime :
   * un capteur maison peut rapporter n'importe quel vocabulaire, et aucune
   * heuristique ne devinera qu'il faut lire « detected » comme une ouverture.
   */
  openWhen?: string[];
  /** Inverse la lecture de l'état : « ouvert » devient « fermé ». */
  invert?: boolean;
  /** Durée de l'animation, en secondes. */
  duration?: number;
  /**
   * Teinte de l'objet fermé, puis ouvert (`#rrggbb`). Absente : aucune teinte
   * dans cet état. Entre les deux, la teinte suit la position animée.
   */
  closedColor?: string;
  openColor?: string;
  /**
   * Intensite de la teinte, de 0 a 1 : la part de la couleur du materiau qu'elle
   * remplace. Absente : 0,55, le dosage d'origine — assez pour se lire, sans
   * effacer la matiere. A 1, l'objet prend entierement la couleur d'etat.
   */
  tintStrength?: number;
}

export interface OwlnestScene {
  version: number;
  scene_id: string;
  model_url?: string;
  anchors: OwlnestAnchor[];
  camera_views: CameraView[];
  cards: import('./cards/types').SceneCard[];
  rules: import('./rules/types').OwlnestRule[];
  parts?: OwlnestPart[];
  settings?: SceneSettings;
}

// ── Lovelace card config ───────────────────────────────────────────────────

export interface CardConfig {
  scene_id?: string;
  model_url?: string;
  anchors?: Record<string, string> | AnchorConfig[];
  show_debug_anchors?: boolean;
  intensity_scale?: number;
  /**
   * Hauteur en pixels, ou `fill` pour occuper toute la hauteur visible sous la
   * carte : le mode d'une tablette murale, ou d'une vue en panneau. Absente :
   * les trois quarts de la largeur.
   */
  height?: number | 'fill';
  sky?: boolean;
  sun_entity?: string;
  weather_entity?: string;
  orbit?: {
    min_distance?: number;
    max_distance?: number;
    max_polar_angle?: number;
  };
  lights?: {
    distance?: number;
    decay?: number;
    transition?: number;
  };
  camera_views?: CameraView[];
  rendering?: RenderingConfig & {
    sky_elevation?: number;
    background_color?: string;
  };
  tap_to_toggle?: boolean;
  cluster_threshold?: number;
  custom_css?: string;
  ui?: {
    show_simulation?: boolean;
    show_editor?: boolean;
    show_lock?: boolean;
    show_capture?: boolean;
    icons?: {
      simulation?: string;
      editor?: string;
      lock_open?: string;
      lock_closed?: string;
      capture?: string;
    };
  };
}

// ── Runtime types ──────────────────────────────────────────────────────────

export interface AnchorEntry {
  light: THREE.PointLight | THREE.SpotLight | null;
  lightTarget?: THREE.Object3D;
  worldPos: THREE.Vector3;
  entityId: string;
  domain: EntityDomain;
  targetIntensity: number;
  targetColor: THREE.Color;
  label: string;
  hidden?: boolean;
  lightStyle?: LightStyle;
  lightIntensity?: number;
  lightDirection?: [number, number, number];
  visibleIf?: import('./rules/types').EntityCondition;
  precision?: number;
  icon?: string;
  /** Couleur d'etat imposee (#rrggbb) — surcharge celle du descripteur. */
  color?: string;
  /** Action au tap imposee — 'default' laisse decider le descripteur. */
  tapAction?: import('./entities/descriptors').TapAction | 'default';
  /** Nature de l'ancre — `entity` par defaut. */
  kind?: AnchorKind;
  /** Nature `menu` : les entrees de la roue. */
  actions?: AnchorAction[];
  /** Nature `nav` : identifiant de la vue camera cible. */
  navViewId?: string;
  /**
   * Multiplicateur de taille pour les overlays dimensionnes par la perspective
   * (vignettes de camera). 1 = taille de reference, deduite des dimensions du
   * modele.
   *
   * Volontairement relatif et non exprime en metres : un export Sweet Home 3D
   * peut etre en centimetres (une maison mesure alors 800 unites de large), et
   * l'utilisateur n'a pas a connaitre l'unite de son GLB.
   */
  size?: number;
  /**
   * Force la presentation d'une ancre d'entite. `auto` suit le descripteur —
   * une camera s'affiche donc en vignette par defaut, mais peut etre ramenee a
   * une simple pastille.
   */
  display?: 'auto' | 'icon' | 'thumbnail';
}

export interface SavedView {
  pos: [number, number, number];
  target: [number, number, number];
  locked: boolean;
}

/** Runtime representation used by the anchor editor */
export interface EditableAnchor {
  entity: string;
  position: THREE.Vector3;
  label: string;
  hidden?: boolean;
  lightStyle?: LightStyle;
  lightIntensity?: number;
  lightDirection?: [number, number, number];
  visibleIf?: import('./rules/types').EntityCondition;
  precision?: number;
  icon?: string;
  /** Couleur d'etat imposee (#rrggbb) — surcharge celle du descripteur. */
  color?: string;
  /** Action au tap imposee — 'default' laisse decider le descripteur. */
  tapAction?: import('./entities/descriptors').TapAction | 'default';
  /** Nature de l'ancre — `entity` par defaut. */
  kind?: AnchorKind;
  /** Nature `menu` : les entrees de la roue. */
  actions?: AnchorAction[];
  /** Nature `nav` : identifiant de la vue camera cible. */
  navViewId?: string;
  /**
   * Multiplicateur de taille pour les overlays dimensionnes par la perspective
   * (vignettes de camera). 1 = taille de reference, deduite des dimensions du
   * modele.
   *
   * Volontairement relatif et non exprime en metres : un export Sweet Home 3D
   * peut etre en centimetres (une maison mesure alors 800 unites de large), et
   * l'utilisateur n'a pas a connaitre l'unite de son GLB.
   */
  size?: number;
  /**
   * Force la presentation d'une ancre d'entite. `auto` suit le descripteur —
   * une camera s'affiche donc en vignette par defaut, mais peut etre ramenee a
   * une simple pastille.
   */
  display?: 'auto' | 'icon' | 'thumbnail';
}
