import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: 'src/service/fs-service.ts',
      fileName: () => 'fs-service.js',
    },
    rollupOptions: {
      external: ['electron', /^node:/],
      output: [{ format: 'cjs', codeSplitting: false }],
    },
  },
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
});
