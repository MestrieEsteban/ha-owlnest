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

/** Supprime une scène côté serveur. Retourne `false` si elle n'existait pas. */
export async function deleteScene(hass: Hass, sceneId: string): Promise<boolean> {
  const res = await hass.callWS<{ success: boolean }>({
    type: 'owlnest/delete_scene',
    scene_id: sceneId,
  });
  return res?.success === true;
}

/**
 * Inventaire d'une scène, pour la lister sans l'ouvrir.
 *
 * Le backend ne renvoie que des noms : compter ancres, ouvrants et règles
 * demande de charger chaque scène. C'est un appel par scène, fait une fois à
 * l'ouverture de la liste — sur une installation réelle, six scènes.
 */
export interface SceneSummary {
  id: string;
  anchors: number;
  parts: number;
  rules: number;
  views: number;
  /** Absent si la scène n'a pas pu être lue. */
  error?: string;
}

export async function summarizeScenes(hass: Hass, ids: string[]): Promise<SceneSummary[]> {
  return Promise.all(ids.map(async (id): Promise<SceneSummary> => {
    try {
      const scene = await loadScene(hass, id);
      return {
        id,
        anchors: scene.anchors?.length ?? 0,
        parts: scene.parts?.length ?? 0,
        rules: scene.rules?.length ?? 0,
        views: scene.camera_views?.length ?? 0,
      };
    } catch (err) {
      // Une scène illisible doit rester visible et supprimable : c'est
      // précisément celle dont on veut se débarrasser.
      return { id, anchors: 0, parts: 0, rules: 0, views: 0, error: String(err) };
    }
  }));
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
  const s = scene.settings;
  return {
    ...base,
    model_url: base.model_url || scene.model_url || '',
    // Scene settings override YAML values (settings are configured from edit mode)
    ...(s?.sun_entity     !== undefined && { sun_entity:     s.sun_entity }),
    ...(s?.weather_entity !== undefined && { weather_entity: s.weather_entity }),
    rendering: s?.rendering ? { ...base.rendering, ...s.rendering } : base.rendering,
    ...(s?.cluster_threshold !== undefined && { cluster_threshold: s.cluster_threshold }),
    ...(s?.orbit              !== undefined && { orbit:             s.orbit }),
    anchors: scene.anchors.map((a) => ({
      entity: a.entity,
      position: a.position,
      label: a.label,
      hidden: a.visible === false ? true : undefined,
      lightStyle: a.lightStyle,
      lightIntensity: a.lightIntensity,
      lightDirection: a.lightDirection,
      visibleIf: a.visibleIf,
      precision: a.precision,
      icon: a.icon,
      color: a.color,
      tapAction: a.tapAction,
      kind: a.kind,
      actions: a.actions,
      navViewId: a.navViewId,
      size: a.size,
      display: a.display,
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
      precision: a.precision,
      icon: a.icon,
      color: a.color,
      tapAction: a.tapAction,
      kind: a.kind,
      actions: a.actions,
      navViewId: a.navViewId,
      size: a.size,
      display: a.display,
    });
  });

  return {
    version: 1,
    scene_id: sceneId,
    model_url: '',
    anchors,
    camera_views: cameraViews ?? (current?.camera_views ?? []),
    cards: current?.cards ?? [],
    rules: current?.rules ?? [],
    parts: current?.parts ?? [],
  };
}
