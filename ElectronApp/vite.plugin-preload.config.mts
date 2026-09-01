import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: { entry: 'src/preload/plugin-preload.ts', fileName: () => 'plugin-preload.js' },
    rollupOptions: { external: ['electron'], output: [{ format: 'cjs', codeSplitting: false }] },
  },
});

