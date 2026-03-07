import * as THREE from 'three';

export type EntityDomain =
  | 'light'
  | 'switch'
  | 'cover'
  | 'climate'
  | 'media_player'
  | 'sensor'
  | 'binary_sensor'
  | string;

export interface HassState {
  state: string;
  attributes: Record<string, unknown>;
}

export interface Hass {
  states: Record<string, HassState>;
  callService(domain: string, service: string, data: Record<string, unknown>): void;
}

/** Named camera preset */
export interface CameraView {
  label: string;
  position: [number, number, number];
  target?: [number, number, number];
}

/** New anchor format stored in YAML config */
export interface AnchorConfig {
  entity: string;
  position: [number, number, number];
  label?: string;
}

export interface CardConfig {
  model_url: string;
  /** Old format: { ha_anchor_name: 'entity_id' } or new format: AnchorConfig[] */
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
  /** If true, overlays start hidden; single tap shows/hides them */
  tap_to_toggle?: boolean;
}

export interface AnchorEntry {
  light: THREE.PointLight | null;
  worldPos: THREE.Vector3;
  entityId: string;
  domain: EntityDomain;
  targetIntensity: number;
  targetColor: THREE.Color;
  label: string;
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
}
