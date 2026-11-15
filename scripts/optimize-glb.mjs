/**
 * Optimise un GLB depuis le poste de travail, avec le cœur de l'optimiseur de
 * la carte (src/optimize/).
 *
 * Le cœur est en TypeScript : on le compile à la volée avec esbuild, déjà
 * présent via Vite, dans un dossier du projet pour que Node y retrouve les
 * dépendances (glTF-Transform, meshoptimizer, sharp, draco3dgltf).
 *
 *   npm run optimize-glb -- maison.glb maison-opt.glb --preset balanced
 *   npm run optimize-glb -- maison.glb --each --report matrice.json
 *
 * Le fichier d'entrée n'est jamais modifié.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = resolve('node_modules/.cache/owlnest-optimize/cli.mjs');
mkdirSync(resolve('node_modules/.cache/owlnest-optimize'), { recursive: true });
await build({
  entryPoints: ['src/optimize/cli.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: out,
  logLevel: 'warning',
});

const { main } = await import(pathToFileURL(out).href);
process.exitCode = await main(process.argv.slice(2));
