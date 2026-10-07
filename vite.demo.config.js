import { defineConfig } from 'vite';

// Démo en ligne : la vraie carte sur un Home Assistant simulé (demo/).
// `npm run demo` pour la lancer en local, `npm run build:demo` pour produire
// le site statique publié sur GitHub Pages.
export default defineConfig({
  root: 'demo',
  // Chemins relatifs : le site est servi sous /ha-owlnest/ sur GitHub Pages.
  base: './',
  publicDir: false,
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: Number(process.env.DEMO_PORT ?? 5180),
    strictPort: true,
    fs: { allow: ['..'] },
  },
});
