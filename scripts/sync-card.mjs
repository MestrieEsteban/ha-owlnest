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
import { dirname } from 'node:path';

const SRC = 'dist/ha-3d-floorplan.js';
const DEST = 'custom_components/owlnest/frontend/ha-3d-floorplan.js';

mkdirSync(dirname(DEST), { recursive: true });
copyFileSync(SRC, DEST);

const kb = (statSync(DEST).size / 1024).toFixed(0);
console.log(`📦 Carte copiée dans l'intégration : ${DEST} (${kb} Ko)`);
