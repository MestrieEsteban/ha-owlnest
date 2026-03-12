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

export interface HassState {
  state: string;
  attributes: Record<string, unknown>;
}

export interface Hass {
  states: Record<string, HassState>;
  callService(domain: string, service: string, data: Record<string, unknown>): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callWS<T = unknown>(msg: Record<string, unknown>): Promise<T>;
}

/** Named camera preset — saved in OwlnestScene.camera_views */
export interface CameraView {
  id?: string;                         // Stable identifier (auto-generated if absent)
  label: string;
  position: [number, number, number];
  target: [number, number, number];    // Always required (defaults [0,0,0] on old data)
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
}

/** A full Owlnest scene, persisted by the backend integration. */
export interface OwlnestScene {
  version: number;
  scene_id: string;
  model_url: string;
  anchors: OwlnestAnchor[];
  camera_views: CameraView[];
  cards: import('./cards/types').SceneCard[];
  rules: import('./rules/types').OwlnestRule[];
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
  rendering?: {
    exposure?: number;
    sun_intensity?: number;
    ambient_intensity?: number;
    shadows?: boolean;
    sky?: boolean;
    sky_elevation?: number;
    fog_density?: number;
    ground_color?: string;
    background_color?: string;
    transparent_background?: boolean;
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
}
