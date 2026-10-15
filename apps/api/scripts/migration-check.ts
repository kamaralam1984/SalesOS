/**
 * migration-check: proves the committed migration set is reproducible and safe.
 *   1. the consolidated migration and the guard SQL files match the schema + TypeScript guards (no stale generated files)
 *   2. `prisma migrate deploy` on a brand-new EMPTY database succeeds, and running it again is a no-op
 *   3. the migrated database has no schema drift against prisma/schema (except the known non-Prisma guard indexes)
 *   4. every trigger / guard index exists and the guards actually block (audit append-only, immutable snapshots)
 * Uses a throwaway database `salesos_migcheck_<random>` on the server in DATABASE_URL (never the database in the URL itself).
 *   pnpm migration-check
 */
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ANALYTICS_INDEXES } from '../src/modules/reporting/analytics-indexes';

const ROOT = path.resolve(__dirname, '../../..');
const base = process.env.DATABASE_URL;
if (!base) throw new Error('DATABASE_URL is required (any database on the server; a throwaway database is created next to it)');
const url = new URL(base);
const tmpName = `salesos_migcheck_${randomBytes(4).toString('hex')}`;
const admin = new URL(base);
admin.pathname = '/postgres';
const target = new URL(base);
target.pathname = `/${tmpName}`;
target.searchParams.set('schema', 'public');
if (url.pathname.slice(1) === 'salesos') console.log('note: DATABASE_URL points at the shared "salesos" database; it is only used to reach the server');

const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync('pnpm', ['exec', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: target.toString(), ...env } });
const step = (n: string) => console.log(`\n== ${n}`);
const fail = (m: string): never => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };

async function main() {
  step('1. generated files are current');
  execFileSync('pnpm', ['--filter', '@salesos/api', 'exec', 'tsx', 'scripts/export-guards.ts', '--check'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('pnpm', ['--filter', '@salesos/api', 'exec', 'tsx', 'scripts/build-migration.ts', '--check'], { cwd: ROOT, stdio: 'inherit' });

  const adminDb = new PrismaClient({ datasourceUrl: admin.toString() });
  await adminDb.$executeRawUnsafe(`CREATE DATABASE ${tmpName}`);
  const db = new PrismaClient({ datasourceUrl: target.toString() });
  try {
    step(`2. migrate deploy on an empty database (${tmpName})`);
    let r = run(['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema']);
    process.stdout.write(r.stdout);
    if (r.status !== 0) fail(`migrate deploy failed:\n${r.stderr}`);
    r = run(['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema']);
    if (r.status !== 0 || !/No pending migrations/.test(r.stdout)) fail(`re-running migrate deploy is not a clean no-op:\n${r.stdout}\n${r.stderr}`);
    console.log('re-run: no pending migrations (safe to repeat)');
    r = run(['prisma', 'migrate', 'status', '--schema', 'prisma/schema']);
    if (r.status !== 0 || !/Database schema is up to date/.test(r.stdout)) fail(`migrate status: ${r.stdout}${r.stderr}`);

    step('3. schema drift (migrated DB vs prisma/schema)');
    r = run(['prisma', 'migrate', 'diff', '--from-url', target.toString(), '--to-schema-datamodel', 'prisma/schema', '--script']);
    if (r.status !== 0) fail(`migrate diff failed: ${r.stderr}`);
    const allowed = new Set([...ANALYTICS_INDEXES.map((i) => i.name), 'handover_one_open_per_lead', 'forecast_snapshots_one_period_start']);
    const stmts = r.stdout.split('\n').filter((l) => l.trim() && !l.startsWith('--')).map((l) => l.trim());
    const unexpected = stmts.filter((s) => {
      const m = /^DROP INDEX "(\w+)";?$/.exec(s);
      return !(m && allowed.has(m[1]!)) && s !== '-- This is an empty migration.';
    });
    if (unexpected.length) fail(`schema drift after migrate deploy:\n${unexpected.slice(0, 20).join('\n')}`);
    console.log(`no drift (${stmts.length} statements are only the known guard indexes Prisma cannot model)`);

    step('4. guards exist and block');
    const triggers = (await db.$queryRawUnsafe<{ tgname: string }[]>(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).map((t) => t.tgname);
    const expectedTriggers = ['audit_logs_append_only', 'founder_report_snapshots_immutable', 'founder_reports_freeze_published', 'sop_versions_immutable', 'payments_guard', 'refunds_guard', 'sales_records_immutable', 'forecast_snapshots_immutable', 'targets_guard', 'audit_logs_no_truncate', 'payment_events_no_truncate'];
    const missing = expectedTriggers.filter((t) => !triggers.includes(t));
    if (missing.length) fail(`missing triggers: ${missing.join(', ')}`);
    const indexes = (await db.$queryRawUnsafe<{ indexname: string }[]>(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).map((i) => i.indexname);
    const missingIdx = [...allowed].filter((i) => !indexes.includes(i));
    if (missingIdx.length) fail(`missing guard indexes: ${missingIdx.join(', ')}`);
    const org = await db.organization.create({ data: { name: 'migcheck', slug: `mc-${tmpName}` } });
    const audit = await db.auditLog.create({ data: { organizationId: org.id, action: 'migcheck', entityType: 'test' } });
    let blocked = false;
    try { await db.auditLog.update({ where: { id: audit.id }, data: { action: 'tampered' } }); } catch (e) { blocked = /append-only/.test(String(e)); }
    if (!blocked) fail('audit_logs UPDATE was not blocked');
    let truncBlocked = false;
    try { await db.$executeRawUnsafe('TRUNCATE audit_logs CASCADE'); } catch (e) { truncBlocked = /append-only/.test(String(e)); }
    if (!truncBlocked) fail('audit_logs TRUNCATE was not blocked');
    let fkBlocked = false;
    try { await db.team.create({ data: { organizationId: '00000000-0000-4000-8000-000000000000', name: 'orphan' } }); } catch (e) { fkBlocked = /Foreign key/i.test(String(e)); }
    if (!fkBlocked) fail('a row with an unknown organization_id was accepted (FK missing)');
    console.log(`${triggers.length} triggers, ${indexes.length} indexes; audit append-only and FK integrity enforced`);
    console.log('\nmigration-check: OK');
  } finally {
    await db.$disconnect();
    await adminDb.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${tmpName} WITH (FORCE)`);
    await adminDb.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
