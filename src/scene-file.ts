/**
 * scene-file.ts — exporter une scène dans un fichier JSON, et la relire.
 *
 * Le fichier enveloppe la scène telle que le serveur la garde : rien n'est
 * recalculé, une scène réimportée est celle qu'on avait exportée. Le modèle 3D
 * n'y est pas — seulement son adresse.
 */

import type { OwlnestScene } from './types';

export const SCENE_FILE_FORMAT = 'owlnest-scene';
export const SCENE_FILE_VERSION = 1;

export interface SceneFile {
  format: typeof SCENE_FILE_FORMAT;
  version: number;
  exported_at: string;
  scene: OwlnestScene;
}

export type SceneFileError = 'invalid_json' | 'not_a_scene' | 'unsupported_version';

export class SceneFileParseError extends Error {
  constructor(readonly code: SceneFileError) {
    super(code);
    this.name = 'SceneFileParseError';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Date locale lisible et triable, sans caractère interdit dans un nom de fichier. */
export function fileTimestamp(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    + `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

/** `salon` → `salon_2026-10-15_21-10-05.json`. */
export function sceneFileName(sceneId: string, now = new Date()): string {
  // Windows refuse ces caractères, et un point final ou une espace finale.
  const safe = sceneId
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/, '');
  return `${safe || 'scene'}_${fileTimestamp(now)}.json`;
}

export function serializeScene(scene: OwlnestScene, now = new Date()): string {
  const file: SceneFile = {
    format: SCENE_FILE_FORMAT,
    version: SCENE_FILE_VERSION,
    exported_at: now.toISOString(),
    scene,
  };
  return JSON.stringify(file, null, 2);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const LISTS = ['anchors', 'camera_views', 'cards', 'rules', 'parts', 'effects'] as const;

/**
 * Relit un fichier exporté.
 *
 * Accepte aussi une scène nue, telle que le stockage de Home Assistant la
 * range : c'est ce qu'on trouve en copiant `.storage/owlnest.scenes` à la main.
 */
export function parseSceneFile(text: string): OwlnestScene {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SceneFileParseError('invalid_json');
  }
  if (!isObject(data)) throw new SceneFileParseError('not_a_scene');

  let raw: unknown = data;
  if (data.format === SCENE_FILE_FORMAT) {
    // Version absente : fichier d'avant le champ, lu comme la version courante.
    const ver = typeof data.version === 'number' ? data.version : SCENE_FILE_VERSION;
    if (ver > SCENE_FILE_VERSION) throw new SceneFileParseError('unsupported_version');
    raw = data.scene;
  } else if (!Array.isArray(data.anchors)) {
    // Sans enveloppe, les ancres sont ce qui distingue une scène d'un JSON quelconque.
    throw new SceneFileParseError('not_a_scene');
  }
  if (!isObject(raw)) throw new SceneFileParseError('not_a_scene');

  for (const key of LISTS) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) throw new SceneFileParseError('not_a_scene');
  }
  if (raw.settings !== undefined && !isObject(raw.settings)) throw new SceneFileParseError('not_a_scene');

  return {
    ...(raw as Partial<OwlnestScene>),
    version: typeof raw.version === 'number' ? raw.version : 1,
    scene_id: typeof raw.scene_id === 'string' ? raw.scene_id : '',
    model_url: typeof raw.model_url === 'string' ? raw.model_url : '',
    anchors: (raw.anchors as OwlnestScene['anchors']) ?? [],
    camera_views: (raw.camera_views as OwlnestScene['camera_views']) ?? [],
    cards: (raw.cards as OwlnestScene['cards']) ?? [],
    rules: (raw.rules as OwlnestScene['rules']) ?? [],
    parts: (raw.parts as OwlnestScene['parts']) ?? [],
    // Comme parts : une scène exportée avec des effets doit les retrouver à l'import.
    effects: (raw.effects as OwlnestScene['effects']) ?? [],
  };
}

/**
 * Nom proposé pour la scène importée : celui qu'elle portait, sinon celui du
 * fichier sans la date ajoutée à l'export.
 */
export function suggestSceneId(scene: OwlnestScene, fileName: string): string {
  const own = scene.scene_id?.trim();
  if (own) return own;
  const base = fileName
    .replace(/\.json$/i, '')
    .replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/, '')
    .trim();
  return base || 'scene';
}

/**
 * Identifiant libre pour une scène importée ou dupliquée.
 *
 * Un fichier réimporté, ou une copie, porte encore le nom d'origine.
 * L'écraser sans demander ferait disparaître la scène déjà là — on suffixe
 * plutôt `_2`, `_3`… À l'import, l'utilisateur peut retaper le nom existant
 * s'il veut vraiment remplacer.
 */
export function uniqueSceneId(desired: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const base = desired.trim() || 'scene';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
