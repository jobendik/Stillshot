import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Vite configuration for STILLSHOT.
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
    open: false,
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
