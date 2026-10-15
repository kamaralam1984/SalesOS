import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: {
    alias: {
      '@salesos/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@salesos/platform-core': path.resolve(__dirname, '../../packages/platform-core/src/index.ts'),
      '@salesos/crm-core': path.resolve(__dirname, '../../packages/crm-core/src/index.ts'),
      '@salesos/cx-core': path.resolve(__dirname, '../../packages/cx-core/src/index.ts'),
      '@salesos/workforce-core': path.resolve(__dirname, '../../packages/workforce-core/src/index.ts'),
    },
  },
  test: { globals: true, globalSetup: ['test/global-setup.ts'], setupFiles: ['test/setup-isolation.ts'], environment: 'node', include: ['test/**/*.spec.ts'], testTimeout: 30000, fileParallelism: false },
});
