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
   * Hauteur du plan de coupe, en fraction de la hauteur du modèle.
   *
   * 1 (défaut) : rien n'est coupé. En dessous, tout ce qui dépasse disparaît —
   * les murs extérieurs s'ouvrent et l'on plonge dans le logement, comme dans
   * une maison de poupée. Un plafond exporté se retire par la même occasion.
   *
   * La coupe se fait dans le nuanceur : elle ne coûte aucun calcul de géométrie
   * et fonctionne sur un modèle fusionné comme sur un modèle découpé.
   */
  cutaway?: number;
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

/** Battant (porte, fenêtre) ou coulissant (volet, baie, porte de garage). */
export type PartMotion = 'swing' | 'slide';

/** Sens du coulissement, dans le repère propre à la pièce. */
export type SlideDirection = 'down' | 'up' | 'start' | 'end';

/**
 * Une pièce du modèle animée par l'état d'une entité.
 *
 * On ne mémorise pas la géométrie, seulement de quoi la retrouver : le nom de
 * la maille et un triangle lui appartenant. L'analyse en composantes connexes
 * a lieu dans l'éditeur, jamais sur la tablette.
 */
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
  label?: string;
  motion: PartMotion;
  /** Côté des gonds, pour un battant. */
  hinge?: 'start' | 'end';
  /** Ouverture d'un battant, en degrés. */
  angle?: number;
  /** Sens de retrait d'un coulissant. */
  slide?: SlideDirection;
  /** Course d'un coulissant, en fraction de sa propre dimension. */
  travel?: number;
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
  height?: number;
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
