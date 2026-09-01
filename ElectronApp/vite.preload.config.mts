import { defineConfig } from 'vite';

export default defineConfig({
  define: { __NTO_PACKAGE_VARIANT__: JSON.stringify(process.env.NTO_PACKAGE_VARIANT ?? 'development') },
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: 'src/preload/preload.ts',
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      external: ['electron'],
      output: [{ format: 'cjs', codeSplitting: false }],
    },
  },
});
