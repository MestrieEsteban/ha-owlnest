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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callWS<T = unknown>(msg: Record<string, unknown>): Promise<T>;
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
  rendering?: {
    /** Overall brightness multiplier (default: 1.4) */
    exposure?: number;
    /** Sun directional light intensity (default: 0.8) */
    sun_intensity?: number;
    /** Hemisphere ambient intensity (default: 0.7) */
    ambient_intensity?: number;
    /** Enable soft shadows (default: true) */
    shadows?: boolean;
    /** Procedural sky (default: true). Set false for plain background */
    sky?: boolean;
    /** Default sun elevation in degrees when no sun_entity (default: 60) */
    sky_elevation?: number;
    /** Fog density — higher = more fog (default: 0.018) */
    fog_density?: number;
    /** Ground plane color as hex string e.g. "#4a6741" (default: green) */
    ground_color?: string;
    /** Background color when sky is disabled, hex string (default: "#0d1117") */
    background_color?: string;
  };
  /** If true, overlays start hidden; single tap shows/hides them */
  tap_to_toggle?: boolean;
  /** If set, anchors within this pixel distance on screen are grouped into a radial menu. Disabled by default. */
  cluster_threshold?: number;
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
