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
});
