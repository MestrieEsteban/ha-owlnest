/**
 * scene.ts — Owlnest scene loading & saving via HA WebSocket.
 *
 * Keeps all backend communication in one place so the main component
 * stays focused on rendering.
 */

import type { Hass, CardConfig, OwlnestScene, OwlnestAnchor, CameraView, EditableAnchor } from './types';

// ── WebSocket helpers ──────────────────────────────────────────────────────

export async function loadScene(hass: Hass, sceneId: string): Promise<OwlnestScene> {
  return hass.callWS<OwlnestScene>({ type: 'owlnest/load_scene', scene_id: sceneId });
}

export async function saveScene(hass: Hass, sceneId: string, data: OwlnestScene): Promise<void> {
  await hass.callWS<{ success: boolean }>({
    type: 'owlnest/save_scene',
    scene_id: sceneId,
    data,
  });
}

export async function listScenes(hass: Hass): Promise<string[]> {
  const res = await hass.callWS<{ scenes: string[] }>({ type: 'owlnest/list_scenes' });
  return res.scenes;
}

// ── Camera view utilities ──────────────────────────────────────────────────

/**
 * Capture the current camera state as a named CameraView.
 * Accepts raw arrays so scene.ts stays free from Three.js imports.
 */
export function captureCameraView(
  position: [number, number, number],
  target: [number, number, number],
  label: string,
): CameraView {
  const fmt = (v: number) => +v.toFixed(4);
  return {
    id: `view_${Date.now()}`,
    label,
    position: position.map(fmt) as [number, number, number],
    target:   target.map(fmt)   as [number, number, number],
  };
}

/**
 * Ensure every CameraView has a stable id and a target.
 * Safe to call on YAML-defined views that predate the id field.
 */
export function normalizeViews(views: CameraView[]): CameraView[] {
  let n = 0;
  return views.map((v) => ({
    ...v,
    id:     v.id     ?? `view_legacy_${n++}`,
    target: v.target ?? [0, 0, 0],
  }));
}

// ── Scene ↔ CardConfig bridge ──────────────────────────────────────────────

/**
 * Merge a loaded scene into the Lovelace card config so the rest of the
 * rendering pipeline doesn't need to know about scenes at all.
 * All anchor fields (lightStyle, lightIntensity, lightDirection, hidden) are preserved.
 */
export function sceneToEffectiveConfig(scene: OwlnestScene, base: CardConfig): CardConfig {
  return {
    ...base,
    model_url: scene.model_url,
    anchors: scene.anchors.map((a) => ({
      entity: a.entity,
      position: a.position,
      label: a.label,
      hidden: a.visible === false ? true : undefined,
      lightStyle: a.lightStyle,
      lightIntensity: a.lightIntensity,
      lightDirection: a.lightDirection,
      visibleIf: a.visibleIf,
    })),
    camera_views: scene.camera_views?.length
      ? normalizeViews(scene.camera_views)
      : (base.camera_views ? normalizeViews(base.camera_views) : []),
    // cards live in the scene only, not in Lovelace YAML
  };
}


// ── Build a scene from editor state ───────────────────────────────────────

export function buildSceneFromEditor(
  sceneId: string,
  editableAnchors: Map<string, EditableAnchor>,
  current: OwlnestScene | null,
  baseConfig: CardConfig,
  cameraViews?: CameraView[],   // When provided, overrides scene.camera_views
): OwlnestScene {
  const anchors: OwlnestAnchor[] = [];
  let idx = 0;

  editableAnchors.forEach((a) => {
    const id = `anchor_${String(idx++).padStart(3, '0')}`;
    anchors.push({
      id,
      entity: a.entity,
      label: a.label || undefined,
      position: [
        +a.position.x.toFixed(4),
        +a.position.y.toFixed(4),
        +a.position.z.toFixed(4),
      ],
      visible: a.hidden ? false : undefined,
      lightStyle: a.lightStyle,
      lightIntensity: a.lightIntensity,
      lightDirection: a.lightDirection,
      visibleIf: a.visibleIf,
    });
  });

  return {
    version: 1,
    scene_id: sceneId,
    model_url: current?.model_url ?? baseConfig.model_url ?? '',
    anchors,
    camera_views: cameraViews ?? (current?.camera_views ?? []),
    cards: current?.cards ?? [],
    rules: current?.rules ?? [],
  };
}
