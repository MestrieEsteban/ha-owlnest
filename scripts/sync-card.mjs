/**
 * Copie le bundle construit dans le dossier de l'intégration.
 *
 * HACS n'installe qu'une catégorie par dépôt. En embarquant la carte dans
 * `custom_components/owlnest/`, une installation en tant qu'intégration suffit :
 * l'intégration sert le fichier et le déclare elle-même (voir frontend.py).
 *
 * Le fichier est donc **versionné**, contrairement au reste de `dist/` : HACS
 * lit le contenu du dépôt au tag, il doit l'y trouver.
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';

const DIR = 'custom_components/owlnest/frontend';

// L'optimiseur (worker à part, chargé à la demande) voyage avec la carte.
const FILES = ['ha-3d-floorplan.js', 'owlnest-optimizer.js'];

mkdirSync(DIR, { recursive: true });
for (const file of FILES) {
  copyFileSync(`dist/${file}`, `${DIR}/${file}`);
  const kb = (statSync(`${DIR}/${file}`).size / 1024).toFixed(0);
  console.log(`📦 Copié dans l'intégration : ${DIR}/${file} (${kb} Ko)`);
}
