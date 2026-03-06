import * as THREE from 'three';

export interface HassState {
  state: string;
  attributes: Record<string, unknown>;
}

export interface Hass {
  states: Record<string, HassState>;
  callService(domain: string, service: string, data: Record<string, unknown>): void;
}

export interface CardConfig {
  model_url: string;
  anchors?: Record<string, string>;
  show_debug_anchors?: boolean;
  intensity_scale?: number;
  height?: number;
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
}

export interface AnchorEntry {
  light: THREE.PointLight;
  worldPos: THREE.Vector3;
  entityId: string;
  targetIntensity: number;
  targetColor: THREE.Color;
}

export interface SavedView {
  pos: [number, number, number];
  target: [number, number, number];
  locked: boolean;
}
