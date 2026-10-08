/**
 * scene.ts — Owlnest scene loading & saving via HA WebSocket.
 *
 * Keeps all backend communication in one place so the main component
 * stays focused on rendering.
 */

import type { Hass, CardConfig, OwlnestScene, OwlnestAnchor, CameraView, EditableAnchor } from './types';

// ── WebSocket helpers ──────────────────────────────────────────────────────

/**
 * Session fallbacks for scenes that could not be loaded.
 *
 * Home Assistant updates the card's `hass` property very frequently. Without
 * remembering a failed scene load, a missing/unavailable scene is requested on
 * every state update; the card then falls back to the Lovelace model and can
 * end up tearing down and reloading the GLB over and over.
 *
 * Keeping a lightweight empty scene for the current page session makes the
 * failure stable: the frontend can still use `model_url`, while a successful
 * save clears the fallback. Reloading Home Assistant also naturally retries.
 */
const failedSceneFallbacks = new Map<string, OwlnestScene>();

/**
 * Scènes que le serveur n'a pas pu lire, pour une autre raison que leur absence.
 *
 * Une scène absente est une scène neuve : la carte peut montrer la démo. Mais
 * quand l'intégration ne répond pas (non chargée, stockage illisible), la vraie
 * scène existe peut-être encore : la démo ferait croire qu'elle est perdue, et
 * un enregistrement l'écraserait. On le retient pour l'éviter.
 */
const unreachableScenes = new Set<string>();

/** Oublie un échec de lecture, pour que le prochain `loadScene` interroge vraiment le serveur. */
export function forgetSceneFailure(sceneId: string): void {
  failedSceneFallbacks.delete(sceneId);
  unreachableScenes.delete(sceneId);
}

/** L'intégration n'a pas pu lire cette scène : ne rien montrer ni écrire à sa place. */
export function sceneUnreachable(sceneId: string): boolean {
  return unreachableScenes.has(sceneId);
}

export function emptyScene(sceneId: string): OwlnestScene {
  return {
    version: 1,
    scene_id: sceneId,
    model_url: '',
    anchors: [],
    camera_views: [],
    cards: [],
    rules: [],
    parts: [],
  };
}

export async function loadScene(hass: Hass, sceneId: string): Promise<OwlnestScene> {
  const fallback = failedSceneFallbacks.get(sceneId);
  if (fallback) return fallback;

  try {
    const scene = await hass.callWS<OwlnestScene>({ type: 'owlnest/load_scene', scene_id: sceneId });
    failedSceneFallbacks.delete(sceneId);
    unreachableScenes.delete(sceneId);
    return scene;
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== 'not_found') unreachableScenes.add(sceneId);
    const scene = emptyScene(sceneId);
    failedSceneFallbacks.set(sceneId, scene);
    console.warn(
      `[Owlnest] Scene "${sceneId}" could not be loaded; using an empty session scene to prevent repeated reloads.`,
      err,
    );
    return scene;
  }
}

export async function saveScene(hass: Hass, sceneId: string, data: OwlnestScene): Promise<void> {
  // La scène affichée n'est qu'un repli : l'écrire remplacerait la vraie.
  if (unreachableScenes.has(sceneId)) throw new Error(`Scene "${sceneId}" could not be read; not overwriting it`);
  await hass.callWS<{ success: boolean }>({
    type: 'owlnest/save_scene',
    scene_id: sceneId,
    data,
  });
  failedSceneFallbacks.delete(sceneId);
}

/** Supprime une scène côté serveur. Retourne `false` si elle n'existait pas. */
export async function deleteScene(hass: Hass, sceneId: string): Promise<boolean> {
  const res = await hass.callWS<{ success: boolean }>({
    type: 'owlnest/delete_scene',
    scene_id: sceneId,
  });
  failedSceneFallbacks.delete(sceneId);
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
      /**
       * Interrogation directe, sans passer par `loadScene`.
       *
       * Celui-ci absorbe les echecs et renvoie une scene vide, ce qui est le bon
       * comportement au rendu : sans cela un chargement rate serait retente a
       * chaque mise a jour de `hass`, et le modele rechargerait en boucle.
       *
       * Mais une liste doit dire la verite. En passant par le repli, une scene
       * illisible s'afficherait comme « vide », et le cache de session la
       * maintiendrait ainsi jusqu'au rechargement de la page.
       */
      const scene = await hass.callWS<OwlnestScene>({
        type: 'owlnest/load_scene',
        scene_id: id,
      });
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
/** Adresse sous laquelle l'intégration sert les plans importés (voir models.py). */
export const IMPORTED_MODELS = '/owlnest_models/';

export function sceneToEffectiveConfig(scene: OwlnestScene, base: CardConfig): CardConfig {
  const s = scene.settings;
  // Un plan importé depuis la carte est le dernier choix explicite de
  // l'utilisateur : il passe devant le model_url du YAML. Sans cela, déposer
  // son plan ne changerait rien chez qui avait suivi l'ancienne installation.
  const imported = scene.model_url?.startsWith(IMPORTED_MODELS) ? scene.model_url : '';
  return {
    ...base,
    model_url: imported || base.model_url || scene.model_url || '',
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
    // Le modèle de la scène survit à l'enregistrement : un modèle importé par
    // glisser-déposer n'existe que là, pas dans la configuration de la carte.
    model_url: current?.model_url ?? '',
    anchors,
    camera_views: cameraViews ?? (current?.camera_views ?? []),
    cards: current?.cards ?? [],
    rules: current?.rules ?? [],
    parts: current?.parts ?? [],
  };
}