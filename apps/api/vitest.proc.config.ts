import { defineConfig } from 'vitest/config';
/** Process-level reliability tests (spawn the compiled API). Run via `pnpm test:proc` (builds dist-l2 first, removes it after). */
export default defineConfig({
  test: { globals: true, environment: 'node', include: ['test-proc/**/*.spec.ts'], testTimeout: 120000, hookTimeout: 120000, fileParallelism: false },
});
