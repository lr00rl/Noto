import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '.vite/renderer/plugin_runtime',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: { entry: 'src/renderer/plugin-runtime/bootstrap.ts', formats: ['es'], fileName: () => 'bootstrap.js' },
    rollupOptions: { output: { codeSplitting: false } },
  },
  plugins: [{
    name: 'noto-plugin-runtime-html',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'index.html',
        source: readFileSync('src/renderer/plugin-runtime/index.html', 'utf8'),
      });
    },
  }],
});
