import { execSync } from 'node:child_process';
import path from 'node:path';

export const WORKER_TEST_DB = 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_wtest?schema=public';

/** Dedicated DB so worker tests never relay events produced by the API test-suite running in parallel. */
export default function setup() {
  const url = process.env.TEST_WORKER_DATABASE_URL ?? WORKER_TEST_DB;
  if (new URL(url).pathname.slice(1) === 'salesos') throw new Error(`Refusing to run worker tests against ${url}`);
  // deterministic start: drop everything a previous run left behind (test database only: the name guard above + `_wtest`)
  if (!/_(wtest|test)$/.test(new URL(url).pathname.slice(1))) throw new Error(`Refusing to reset ${url}: not a dedicated test database`);
  execSync('pnpm exec prisma db execute --stdin --schema prisma/schema', {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, DATABASE_URL: url },
    input: 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // TEST_DB_MODE=migrate: schema ONLY from the committed migrations (same as the API suite)
  const cmd = process.env.TEST_DB_MODE === 'migrate' ? 'pnpm exec prisma migrate deploy --schema prisma/schema' : 'pnpm exec prisma db push --schema prisma/schema --skip-generate --accept-data-loss';
  execSync(cmd, {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
