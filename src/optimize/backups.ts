/**
 * backups.ts — les fichiers de modèle côté serveur : copies d'origine,
 * versions optimisées, ménage.
 *
 * Règle : le fichier d'origine n'est jamais remplacé. Une version optimisée
 * s'envoie sous un nom neuf, et la scène retient l'adresse de l'original pour
 * pouvoir y revenir. Un modèle de `/local` (dossier `www` de l'utilisateur)
 * n'est ni copié ni effacé : seule son adresse est notée.
 */

import type { Hass } from '../types';
import { modelSlug } from '../import/plan';

export interface ServerModel {
  name: string;
  url: string;
  size: number;
  modified: number;
  /** Scene ids that reference this file as ``model_url`` or ``model_original_url``. */
  scenes?: string[];
}

export interface ModelListResult {
  models: ServerModel[];
  /** Distinct model URLs still referenced by any scene (compat / delete checks). */
  in_use: string[];
  /** URL → scene_ids; may omit query-string variants the UI normalizes. */
  used_by?: Record<string, string[]>;
}

export async function listModels(hass: Hass): Promise<ModelListResult> {
  return hass.callWS({ type: 'owlnest/list_models' });
}

/** Scene ids for a model file, matching bare paths (ignore ``?query``). */
export function scenesForModel(list: ModelListResult, url: string): string[] {
  const bare = url.split(/[?#]/)[0];
  if (list.used_by) {
    const out = new Set<string>();
    for (const [u, ids] of Object.entries(list.used_by)) {
      if (u.split(/[?#]/)[0] === bare) for (const id of ids) out.add(id);
    }
    if (out.size) return [...out].sort();
  }
  const fromModel = list.models.find((m) => m.url.split(/[?#]/)[0] === bare)?.scenes;
  return fromModel ? [...fromModel].sort() : [];
}

/** Whether any scene still points at this file (same bare URL). */
export function modelInUse(list: ModelListResult, url: string): boolean {
  if (scenesForModel(list, url).length) return true;
  const bare = url.split(/[?#]/)[0];
  return list.in_use.some((u) => u.split(/[?#]/)[0] === bare);
}

/** Copie de sûreté de l'original ; pour `/local`, l'adresse telle quelle. */
export async function backupModel(hass: Hass, url: string): Promise<{ url: string; copied: boolean }> {
  return hass.callWS({ type: 'owlnest/backup_model', url });
}

/** Efface une version que plus aucune scène n'utilise (le serveur le vérifie). */
export async function deleteModel(hass: Hass, url: string): Promise<boolean> {
  const r = await hass.callWS<{ deleted: boolean }>({ type: 'owlnest/delete_model', url });
  return r.deleted;
}

/** Le nom lisible d'un modèle, sans dossier, extension ni horodatage. */
export function modelBaseName(url: string): string {
  let name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.glb$/i, '');
  // Les marques s'empilent : `maison-<date>-orig-<date>`, `maison-opt-<date>`…
  for (let prev = ''; prev !== name;) {
    prev = name;
    name = name.replace(/-\d{14}$/, '').replace(/-(orig|opt)$/, '');
  }
  return name || 'maison';
}

/** Nom de fichier d'une version optimisée : le nom d'origine, marqué, horodaté. */
export function optimizedSlug(url: string, now: Date = new Date()): string {
  return modelSlug(`${modelBaseName(url).slice(0, 36)}-opt`, now);
}

/** Nom de fichier de l'original déposé, avant son optimisation à l'import. */
export function originalSlug(name: string, now: Date = new Date()): string {
  return modelSlug(`${name.slice(0, 35)}-orig`, now);
}

/** Une version de l'optimiseur (ni l'original, ni une copie de sûreté) ? */
export function isOptimizedUrl(url: string): boolean {
  return /\/owlnest_models\/[^/]*-opt-\d{14}\.glb/.test(url);
}
