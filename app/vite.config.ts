import { defineConfig } from 'vitest/config';

// ARCHITECTURE.md §7
export default defineConfig({
  base: './', // works from CloudFront root and from a local folder
  build: { target: 'es2022' },
  server: { port: 5173 },
  preview: { port: 4173 },
  test: { environment: 'node' },
});
