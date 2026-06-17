import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Professional Vite configuration for the StillShot temporal shooter.
// - Path alias `@` -> `src`
// - three.js split into its own vendor chunk for cleaner caching
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2021',
    sourcemap: true,
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
