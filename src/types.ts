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

// ── 3D Panel types ─────────────────────────────────────────────────────────

export type PanelBlock =
  | { type: 'heading'; text: string; color?: string }
  | { type: 'entity';  entity_id: string; label?: string }
  | { type: 'metric';  entity_id: string; label?: string; unit?: string }
  | { type: 'badge';   entity_id: string; label?: string }
  | { type: 'button';  label: string; entity_id: string; service: string; domain: string }
  | { type: 'divider' }
  | { type: 'text';    content: string; color?: string }

export interface Panel3D {
  id: string;
  name: string;
  position: [number, number, number];
  rotation?: [number, number, number];  // euler XYZ radians; absent = billboard mode
  scale?: number;                        // world-space width in metres, default 1.2
  billboard?: boolean;                   // default true — always face camera
  blocks: PanelBlock[];
  visible?: boolean;                     // default true
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
}

/**
 * A full Owlnest scene, persisted by the backend integration.
 * camera_views, panels and rules are reserved for future use.
 */
export interface OwlnestScene {
  version: number;
  scene_id: string;
  model_url: string;
  anchors: OwlnestAnchor[];
  camera_views: CameraView[];
  panels: Panel3D[];
  rules: unknown[];
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
  panels?: Panel3D[];
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
}
