import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '.vite/renderer/main_window',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    // Emit every asset as a file rather than inlining small ones.
    //
    // A font small enough to be inlined becomes a `data:` URL, which the
    // production Content Security Policy refuses under `font-src 'self'`.
    // Loosening the policy to permit `data:` fonts would be the easier fix and
    // the wrong one: the asset is ours and can simply be served from the
    // bundle like the rest.
    assetsInlineLimit: 0,
  },
});

