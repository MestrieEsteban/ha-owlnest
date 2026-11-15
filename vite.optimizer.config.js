import { defineConfig } from 'vite';

/**
 * Le worker d'optimisation, construit à part : glTF-Transform n'entre jamais
 * dans la carte, qui le charge au premier « Analyser » (voir optimize/client.ts).
 *
 * Format IIFE : un worker classique, qui peut charger le décodeur Draco par
 * `importScripts`. `emptyOutDir` reste faux, la carte vient d'être construite
 * dans le même dossier.
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/optimize/worker.ts',
      formats: ['iife'],
      name: 'OwlnestOptimizer',
      fileName: () => 'owlnest-optimizer.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: true,
  },
});
