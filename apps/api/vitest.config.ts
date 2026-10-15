import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import path from 'node:path';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@salesos/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@salesos/validation': path.resolve(__dirname, '../../packages/validation/src/index.ts'),
      '@salesos/platform-core': path.resolve(__dirname, '../../packages/platform-core/src/index.ts'),
      '@salesos/crm-core': path.resolve(__dirname, '../../packages/crm-core/src/index.ts'),
      '@salesos/cx-core': path.resolve(__dirname, '../../packages/cx-core/src/index.ts'),
      '@salesos/workforce-core': path.resolve(__dirname, '../../packages/workforce-core/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
