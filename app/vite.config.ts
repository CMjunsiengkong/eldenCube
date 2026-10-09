import { defineConfig } from 'vitest/config';

// ARCHITECTURE.md §7
export default defineConfig({
  base: './', // works from CloudFront root and from a local folder
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000, // kB — three.js is ~700 kB unminified; 137 kB gzipped
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  test: { environment: 'node' },
});
