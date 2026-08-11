import { defineConfig } from 'vite';

/**
 * Configuration du site vitrine.
 *
 * Séparée de `vite.config.js`, qui produit une **bibliothèque** (un seul module
 * pour Lovelace) et n'a donc pas de page d'entrée. Ici on veut l'inverse : une
 * application classique, avec `site/index.html` pour racine.
 *
 *   npm run site        serveur de développement
 *   npm run site:build  sortie statique dans dist-site/
 */
export default defineConfig({
  root: 'site',
  // Chemins relatifs : le site doit fonctionner servi depuis un sous-dossier,
  // ce qui est le cas sur GitHub Pages (`/ha-owlnest/`).
  base: './',
  publicDir: false,
  build: {
    outDir: '../dist-site',
    emptyOutDir: true,
    /**
     * `await` au niveau du module, utilisé pour charger le modèle avant de
     * construire la scène, exige ES2022 (Chrome 89, Safari 15).
     *
     * Le compromis est sans conséquence ici : la page repose sur WebGL et
     * Three.js, qui excluent déjà les navigateurs plus anciens. La carte
     * elle-même, produite par `vite.config.js`, garde une cible plus large.
     */
    target: 'es2022',
    // Le modèle fait 0,5 Mo : au-delà du seuil par défaut, Vite l'inlinerait
    // en base64, ce qui gonflerait le JavaScript de 33 %.
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1600,
  },
  server: { port: 5174, strictPort: true, open: false },
});
