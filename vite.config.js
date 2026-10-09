import { defineConfig } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * En dev, sert `/owlnest_frontend/…` depuis le dossier de l'intégration, comme
 * Home Assistant le fait en production : maison de démo, meubles du catalogue.
 */
function integrationFiles() {
  const root = join(dirname(fileURLToPath(import.meta.url)), 'custom_components', 'owlnest', 'frontend');
  const types = { '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.txt': 'text/plain' };
  return {
    name: 'owlnest-integration-files',
    configureServer(server) {
      server.middlewares.use('/owlnest_frontend', (req, res, next) => {
        const file = normalize(join(root, decodeURIComponent((req.url ?? '').split('?')[0])));
        if (!file.startsWith(root)) return next();
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          return next();
        }
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        // La page est servie par Home Assistant, les fichiers par Vite : sans
        // cet en-tête, le navigateur refuse de les lire.
        res.setHeader('Access-Control-Allow-Origin', '*');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [integrationFiles()],
  build: {
    lib: {
      entry: 'src/ha-3d-floorplan.ts',
      formats: ['es'],
      fileName: () => 'ha-3d-floorplan.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    outDir: 'dist',
    minify: true,
  },
  server: {
    // Écoute sur 0.0.0.0 : le module est chargé par le navigateur qui affiche
    // HA (PC ou tablette), pas par cette machine — localhost ne suffirait pas.
    host: true,
    port: Number(process.env.DEV_PORT ?? 5173),
    // Sans strictPort, un repli sur 5174 laisserait la ressource Lovelace
    // pointer vers un port mort, sans message d'erreur.
    strictPort: true,
    // HA charge le module depuis une autre origine.
    cors: true,
    watch: {
      // Sur Windows, l'observation native rate des écritures : le serveur
      // continue alors de servir une transformation périmée, et on débogue du
      // code qui n'est plus celui du disque. La scrutation coûte un peu de CPU
      // et supprime la classe de problème.
      usePolling: true,
      interval: 300,
    },
  },
});
