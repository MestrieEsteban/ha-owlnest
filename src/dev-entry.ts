/**
 * dev-entry.ts — point d'entrée servi par Vite en développement.
 *
 * Chargé par Home Assistant via une ressource Lovelace pointant sur
 * http://<ip-dev>:5173/src/dev-entry.ts (voir scripts/ha-dev.mjs).
 *
 * Ce fichier n'entre jamais dans le bundle de production : vite.config.js
 * construit à partir de ha-3d-floorplan.ts.
 */

import './ha-3d-floorplan';

// Un custom element ne peut pas être redéfini : le HMR à chaud est un cul-de-sac
// ici. On force donc un rechargement complet de la page à chaque modification,
// ce qui reste bien plus rapide que rebuild + recopie + redémarrage.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => location.reload());
  import.meta.hot.on('vite:beforeFullReload', () => location.reload());
  import.meta.hot.accept(() => location.reload());

  console.info(
    '%c[Owlnest]%c mode dev — rechargement auto à chaque sauvegarde',
    'color:#6C63FF;font-weight:bold',
    'color:inherit',
  );
}
