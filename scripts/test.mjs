/**
 * Lance les tests unitaires.
 *
 * Les modules purs du projet (moteur de règles, descripteurs, profils qualité)
 * n'ont besoin ni de DOM ni de navigateur. On les compile en JavaScript dans un
 * dossier temporaire avec esbuild — déjà présent via Vite — puis on laisse le
 * lanceur intégré de Node exécuter les fichiers `*.test.mjs`.
 *
 * Pas de framework, pas de dépendance ajoutée.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

/** Modules compilés vers le dossier de test, avec leurs dépendances internes. */
const ENTRIES = [
  'src/rules/engine.ts',
  'src/rules/types.ts',
  'src/types.ts',
];

const out = mkdtempSync(join(tmpdir(), 'owlnest-test-'));
const rulesDir = join(out, 'rules');

try {
  // Un bundle par module, pour que les imports relatifs des tests fonctionnent
  // sans avoir à reproduire l'arborescence complète.
  for (const entry of ENTRIES) {
    const name = basename(entry).replace(/\.ts$/, '.mjs');
    const dest = entry.startsWith('src/rules/') ? join(rulesDir, name) : join(out, name);
    execFileSync('npx', [
      'esbuild', entry,
      '--bundle', '--format=esm', '--platform=node',
      '--log-level=warning',
      `--outfile=${dest}`,
    ], { stdio: 'inherit', shell: process.platform === 'win32' });
  }

  // Les fichiers de test rejoignent leurs modules.
  let count = 0;
  for (const dir of ['src/rules']) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.test.mjs')) continue;
      copyFileSync(join(dir, f), join(rulesDir, f));
      count++;
    }
  }

  if (count === 0) {
    console.log('Aucun fichier *.test.mjs trouvé.');
    process.exit(0);
  }

  execFileSync(process.execPath, ['--test', rulesDir], { stdio: 'inherit' });
} finally {
  rmSync(out, { recursive: true, force: true });
}
