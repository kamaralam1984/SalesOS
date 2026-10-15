import { execSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ensureDbGuards } from '../src/common/prisma/db-guards';
import { ensureSecurityGuards } from '../src/common/prisma/security-guards';
import { ensureWorkforceGuards } from '../src/common/prisma/workforce-guards';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentb_test?schema=public';

/** Push the current Prisma schema to the dedicated test DB (never the shared `salesos` DB). */
export default async function setup() {
  if (new URL(url).pathname.slice(1) === 'salesos') throw new Error(`Refusing to run tests against ${url}`);
  const root = path.resolve(__dirname, '../../..');
  // TEST_DB_MODE=migrate builds the schema ONLY with the committed migrations (proves `migrate deploy` produces a working database);
  // the default `db push` is the fast path for local iteration.
  if (process.env.TEST_DB_MODE === 'migrate') {
    if (!/_(wtest|test)$/.test(new URL(url).pathname.slice(1))) throw new Error(`Refusing to reset ${url}: not a dedicated test database`);
    execSync('pnpm exec prisma db execute --stdin --schema prisma/schema', {
      cwd: root, env: { ...process.env, DATABASE_URL: url }, input: 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;', stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  const cmd = process.env.TEST_DB_MODE === 'migrate' ? 'pnpm exec prisma migrate deploy --schema prisma/schema' : 'pnpm exec prisma db push --schema prisma/schema --skip-generate --accept-data-loss';
  execSync(cmd, {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasourceUrl: url });
  await ensureDbGuards(prisma);
  await ensureSecurityGuards(prisma);
  await ensureWorkforceGuards(prisma);
  await prisma.$disconnect();
}
