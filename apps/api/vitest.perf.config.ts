import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import path from 'node:path';

/** Performance / EXPLAIN run for the analytics KPI layer on a generated anonymised dataset: `pnpm --filter @salesos/api perf:analytics`. */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@salesos/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      '@salesos/validation': path.resolve(__dirname, '../../packages/validation/src/index.ts'),
      '@salesos/platform-core': path.resolve(__dirname, '../../packages/platform-core/src/index.ts'),
      '@salesos/crm-core': path.resolve(__dirname, '../../packages/crm-core/src/index.ts'),
      '@salesos/cx-core': path.resolve(__dirname, '../../packages/cx-core/src/index.ts'),
    },
  },
  test: { globals: true, environment: 'node', include: ['perf/**/*.perf.ts'], testTimeout: 1_800_000, hookTimeout: 1_800_000, fileParallelism: false, setupFiles: ['perf/setup.ts'] },
});
