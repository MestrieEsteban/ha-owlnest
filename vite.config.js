import { defineConfig } from 'vite';

export default defineConfig({
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
