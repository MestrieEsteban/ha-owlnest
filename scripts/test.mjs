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
  'src/parts-clips.ts',
  'src/parts-runtime.ts',
  'src/model-outline.ts',
  'src/part-highlight.ts',
  'src/part-tint.ts',
  'src/part-carry.ts',
  'src/coplanar.ts',
  'src/lights.ts',
  'src/scale.ts',
  'src/model-errors.ts',
  'src/i18n.ts',
  'src/demo.ts',
  'src/import/obj-to-glb.ts',
  'src/import/plan.ts',
  'src/import/upload.ts',
  'src/import/sh3d.ts',
  'src/import/lighten.ts',
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
  const copied = [];
  for (const file of tests) {
    const dest = join(out, relative('src', file));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
    copied.push(dest);
  }

  if (tests.length === 0) {
    console.log('Aucun fichier *.test.mjs trouvé.');
    process.exit(0);
  }

  // Les fichiers sont passes un par un, et non le dossier : Node 24 traite un
  // repertoire nu comme un module a charger et echoue avant d'avoir teste quoi
  // que ce soit. La liste explicite fonctionne sur toutes les versions.
  execFileSync(process.execPath, ['--test', ...copied], { stdio: 'inherit' });
} finally {
  rmSync(out, { recursive: true, force: true });
}
