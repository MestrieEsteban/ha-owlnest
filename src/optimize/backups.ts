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
}

export async function listModels(hass: Hass): Promise<{ models: ServerModel[]; in_use: string[] }> {
  return hass.callWS({ type: 'owlnest/list_models' });
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
