/**
 * Lance les tests unitaires.
 *
 * Les modules testables du projet (moteur de règles, géométrie des ouvrants,
 * descripteurs, profils qualité) n'ont besoin ni de DOM ni de navigateur. On les
 * compile en JavaScript dans un dossier temporaire avec esbuild — déjà présent
 * via Vite — puis on laisse le lanceur intégré de Node exécuter les fichiers
 * `*.test.mjs`.
 *
 * L'arborescence de `src/` est reproduite telle quelle dans le dossier
 * temporaire, pour que les imports relatifs des tests fonctionnent sans
 * réécriture.
 *
 * Pas de framework, pas de dépendance ajoutée.
 */
import { execFileSync } from 'node:child_process';
import { rmSync, readdirSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

/** Modules compilés vers le dossier de test, avec leurs dépendances internes. */
const ENTRIES = [
  'src/rules/engine.ts',
  'src/rules/types.ts',
  'src/types.ts',
  'src/parts.ts',
  'src/parts-runtime.ts',
  'src/coplanar.ts',
  'src/lights.ts',
  'src/scale.ts',
  'src/model-errors.ts',
];

/**
 * Le dossier de build reste dans le projet, et non dans `%TEMP%`.
 *
 * Les tests qui manipulent de la géométrie importent `three` : depuis un
 * dossier temporaire hors projet, Node ne saurait pas le résoudre. Placé ici,
 * la résolution remonte naturellement jusqu'à `node_modules/`.
 */
const out = '.test-build';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/** Tous les `*.test.mjs` sous `src/`, chemin relatif au projet. */
function findTests(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...findTests(full));
    else if (name.endsWith('.test.mjs')) found.push(full);
  }
  return found;
}

try {
  for (const entry of ENTRIES) {
    const dest = join(out, relative('src', entry).replace(/\.ts$/, '.mjs'));
    mkdirSync(dirname(dest), { recursive: true });
    execFileSync('npx', [
      'esbuild', entry,
      '--bundle', '--format=esm', '--platform=node',
      // `three` reste externe : embarquer une seconde copie dans le bundle
      // ferait cohabiter deux jeux de classes, et un objet construit par le
      // test ne serait plus reconnu par le module testé.
      '--external:three',
      '--log-level=warning',
      `--outfile=${dest}`,
    ], { stdio: 'inherit', shell: process.platform === 'win32' });
  }

  const tests = findTests('src');
  for (const file of tests) {
    const dest = join(out, relative('src', file));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
  }

  if (tests.length === 0) {
    console.log('Aucun fichier *.test.mjs trouvé.');
    process.exit(0);
  }

  execFileSync(process.execPath, ['--test', out], { stdio: 'inherit' });
} finally {
  rmSync(out, { recursive: true, force: true });
}
