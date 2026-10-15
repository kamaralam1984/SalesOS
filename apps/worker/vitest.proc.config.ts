import { defineConfig } from 'vitest/config';
import path from 'node:path';
/** Process-level reliability tests (spawn real worker processes). Run via `pnpm test:proc`; builds dist-l2 first. */
export default defineConfig({
  resolve: {
    alias: {
      '@salesos/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@salesos/platform-core': path.resolve(__dirname, '../../packages/platform-core/src/index.ts'),
      '@salesos/crm-core': path.resolve(__dirname, '../../packages/crm-core/src/index.ts'),
      '@salesos/cx-core': path.resolve(__dirname, '../../packages/cx-core/src/index.ts'),
    },
  },
  test: { globals: true, globalSetup: ['test/global-setup.ts'], setupFiles: ['test/setup-isolation.ts'], environment: 'node', include: ['test-proc/**/*.spec.ts'], testTimeout: 120000, hookTimeout: 600000, fileParallelism: false },
});
