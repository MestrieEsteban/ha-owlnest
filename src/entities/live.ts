/**
 * L'état de Home Assistant en direct, pour les écrans qui restent ouverts : la
 * fiche d'un ouvrant, la liste des appareils, le sélecteur d'entités.
 *
 * Home Assistant remplace l'objet `hass` à chaque changement d'état : un écran
 * qui garde celui reçu à son ouverture affiche un état figé. La carte publie
 * ici chaque nouvel objet, et les écrans s'abonnent le temps d'être ouverts.
 */
import type { Hass } from '../types';

let current: Hass | null = null;
const subscribers = new Set<(hass: Hass) => void>();

export function publishHass(hass: Hass) {
  current = hass;
  for (const fn of subscribers) {
    try { fn(hass); } catch (err) { console.warn('[Owlnest] live state:', err); }
  }
}

export function liveHass(): Hass | null {
  return current;
}

/**
 * S'abonne aux changements, au plus une fois par `minMs` : un capteur de
 * puissance peut publier plusieurs fois par seconde. Rend la fonction de
 * désabonnement.
 */
export function onHass(fn: (hass: Hass) => void, minMs = 300): () => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (hass: Hass) => {
    const wait = last + minMs - Date.now();
    if (wait <= 0) { last = Date.now(); fn(hass); return; }
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      last = Date.now();
      if (current) fn(current);
    }, wait);
  };
  subscribers.add(wrapped);
  return () => {
    subscribers.delete(wrapped);
    if (timer) clearTimeout(timer);
  };
}
