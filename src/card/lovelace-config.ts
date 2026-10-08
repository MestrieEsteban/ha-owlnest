/**
 * lovelace-config.ts — inscrire la scène choisie dans la configuration de la carte.
 *
 * Choisir ou créer une scène depuis le panneau ne doit concerner que la carte
 * où l'on clique. Retenir ce choix dans le navigateur ne suffit pas : trois
 * cartes sans `scene_id` partagent la même clé, et un autre appareil ne le
 * verrait pas. On l'écrit donc là où Home Assistant range la carte, dans le
 * tableau de bord, comme si on l'avait réglé dans l'éditeur visuel.
 *
 * Ce n'est possible que si l'on retrouve la carte sans ambiguïté : un tableau
 * de bord en mode YAML, ou deux cartes identiques, et on renonce — la carte
 * retombe alors sur le choix retenu dans le navigateur.
 */

import type { Hass, CardConfig } from '../types';

const CARD_TYPE = 'custom:ha-3d-floorplan';

/** Même configuration, à l'ordre des clés près. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Cartes Owlnest du tableau de bord identiques à `card`.
 *
 * Rend les objets eux-mêmes : les modifier modifie la configuration à
 * enregistrer.
 */
export function findCards(dashboard: unknown, card: CardConfig): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj.type === CARD_TYPE && same(obj, card)) out.push(obj);
    for (const v of Object.values(obj)) if (v && typeof v === 'object') walk(v);
  };
  walk(dashboard);
  return out;
}

/** Le tableau de bord affiché : `null` pour celui par défaut (`/lovelace`). */
export function dashboardPath(pathname: string): string | null {
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  return !first || first === 'lovelace' ? null : first;
}

/**
 * Écrit `scene_id` dans la carte du tableau de bord. Rend `false` sans rien
 * changer quand la carte n'est pas identifiable de façon sûre, ou que le
 * tableau de bord n'est pas modifiable (mode YAML, droits).
 */
export async function assignScene(hass: Hass, card: CardConfig, sceneId: string): Promise<boolean> {
  if (hass.user?.is_admin === false) return false;
  const url_path = dashboardPath(location.pathname);
  try {
    const config = await hass.callWS<Record<string, unknown>>({ type: 'lovelace/config', url_path });
    const matches = findCards(config, card);
    if (matches.length !== 1) return false;
    matches[0].scene_id = sceneId;
    await hass.callWS({ type: 'lovelace/config/save', url_path, config });
    return true;
  } catch (err) {
    console.info('[Owlnest] scene kept in this browser only:', err);
    return false;
  }
}
