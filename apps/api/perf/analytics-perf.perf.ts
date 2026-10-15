import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../test/helpers/app';
import { createOrg, createUser } from '../test/helpers/factory';
import { DashboardsService } from '../src/modules/reporting/dashboards/dashboards.service';
import { KpiService } from '../src/modules/reporting/kpi/kpi.service';
import { KPI_IDS } from '../src/modules/reporting/kpi/registry';
import { ReportsService } from '../src/modules/reporting/reports/reports.service';
import { ReconciliationService } from '../src/modules/reporting/reconciliation/reconciliation.service';
import { PermissionResolver } from '../src/common/authz/principal.loader';
import type { Principal } from '../src/common/authz';
import type { RoleKey } from '@salesos/shared-types';

/**
 * Generated, anonymised dataset (no real names or numbers): LEADS leads, ~4 activities per lead (calls + tasks), deals, payments, refunds,
 * targets. Sizes via env: PERF_LEADS (default 60000). The test measures cold + warm timings for every KPI, the dashboards, reports,
 * reconciliation and an export-sized report, prints a table, captures the slowest statements and runs EXPLAIN (ANALYZE, BUFFERS) on them.
 */
const LEADS = Number(process.env.PERF_LEADS ?? 60_000);
const CALLS = Number(process.env.PERF_CALLS ?? LEADS * 4);
const TASKS = Number(process.env.PERF_TASKS ?? Math.round(LEADS * 2));

let t: TestApp;
let prisma: PrismaClient;
let orgId: string;
const principals: Record<string, Principal> = {};

const exec = (sql: string) => prisma.$executeRawUnsafe(sql);

async function principalOf(userId: string): Promise<Principal> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { roleAssignments: { include: { role: true } } } });
  const roles = u.roleAssignments.map((a) => a.role.key as RoleKey);
  const resolver = t.app.get(PermissionResolver);
  return { userId: u.id, organizationId: u.organizationId, email: u.email, name: u.name, managerId: u.managerId, roles, permissions: resolver.effective(roles), sessionId: 'perf', sessionFamilyId: 'perf' };
}

beforeAll(async () => {
  execSync('pnpm exec prisma db push --schema prisma/schema --skip-generate --accept-data-loss', { cwd: path.resolve(__dirname, '../../..'), env: { ...process.env }, stdio: 'pipe' });
  t = await createTestApp();
  prisma = t.prisma;
  const existing = await prisma.lead.count();
  if (existing >= LEADS) {
    const org = await prisma.organization.findFirstOrThrow({ where: { slug: { startsWith: 'perf-' } } });
    orgId = org.id;
  } else {
    await generate();
  }
  const founder = await prisma.user.findFirstOrThrow({ where: { organizationId: orgId, roleAssignments: { some: { role: { key: 'FOUNDER_CEO' } } } } });
  const manager = await prisma.user.findFirstOrThrow({ where: { organizationId: orgId, roleAssignments: { some: { role: { key: 'SALES_MANAGER' } } } }, orderBy: { name: 'asc' } });
  const exec = await prisma.user.findFirstOrThrow({ where: { organizationId: orgId, roleAssignments: { some: { role: { key: 'SALES_EXECUTIVE' } } } }, orderBy: { name: 'asc' } });
  principals.founder = await principalOf(founder.id);
  principals.manager = await principalOf(manager.id);
  principals.executive = await principalOf(exec.id);
}, 1_800_000);
afterAll(async () => t?.close());

async function generate() {
  const started = Date.now();
  const org = await createOrg(prisma, 'perf');
  await prisma.organization.update({ where: { id: org.id }, data: { slug: `perf-${org.id.slice(0, 8)}` } });
  orgId = org.id;
  const founder = await createUser(prisma, org, { roles: ['FOUNDER_CEO'], name: 'Perf Founder' });
  const tl = await createUser(prisma, org, { roles: ['SALES_TEAM_LEAD'], managerId: founder.id, name: 'Perf Lead' });
  const managers: string[] = [];
  const execs: string[] = [];
  for (let m = 0; m < 5; m += 1) {
    const mg = await createUser(prisma, org, { roles: ['SALES_MANAGER'], managerId: tl.id, name: `Perf Manager ${m}` });
    managers.push(mg.id);
    for (let e = 0; e < 8; e += 1) execs.push((await createUser(prisma, org, { roles: ['SALES_EXECUTIVE'], managerId: mg.id, name: `Perf Executive ${m}-${e}` })).id);
  }
  await prisma.user.updateMany({ where: { organizationId: orgId }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
  const team = await prisma.team.create({ data: { organizationId: orgId, name: 'Perf team', leadUserId: managers[0]! } });
  await prisma.teamMembership.createMany({ data: execs.slice(0, 8).map((u) => ({ teamId: team.id, userId: u })) });
  const programs = Array.from({ length: 5 }, (_, i) => ({ id: crypto.randomUUID(), organizationId: orgId, code: `P${i}`, name: `Program ${i}` }));
  const sources = Array.from({ length: 6 }, (_, i) => ({ id: crypto.randomUUID(), organizationId: orgId, name: `Source ${i}` }));
  await prisma.program.createMany({ data: programs });
  await prisma.leadSource.createMany({ data: sources });
  const execArr = `ARRAY[${execs.map((e) => `'${e}'::uuid`).join(',')}]`;
  const progArr = `ARRAY[${programs.map((p) => `'${p.id}'::uuid`).join(',')}]`;
  const srcArr = `ARRAY[${sources.map((p) => `'${p.id}'::uuid`).join(',')}]`;
  // leads: 6 months back, ~70% OPEN, 12% WON, 15% LOST, 3% unassigned
  await exec(`
    INSERT INTO leads (id, organization_id, full_name, phone_e164, phone_raw, phone_valid, source_id, program_id, assigned_to_id, team_id, status, stage_category, next_action_at, won_value, won_at, lost_reason, last_activity_at, first_contact_at, assigned_at, created_at, updated_at, call_attempt_count, version)
    SELECT gen_random_uuid(), '${orgId}', 'Lead ' || lpad(g::text, 7, '0'), '+9170' || lpad(g::text, 8, '0'), '70' || lpad(g::text, 8, '0'), true,
           (${srcArr})[1 + (g % 6)], (${progArr})[1 + (g % 5)],
           CASE WHEN g % 33 = 0 THEN NULL ELSE (${execArr})[1 + (g % 40)] END, CASE WHEN g % 5 = 0 THEN '${team.id}'::uuid ELSE NULL END,
           CASE WHEN r < 0.12 THEN 'WON' WHEN r < 0.27 THEN 'LOST' ELSE (ARRAY['NEW','CONTACT_ATTEMPTED','CONNECTED','DEMO_ATTENDED'])[1 + (g % 4)] END,
           CASE WHEN r < 0.12 THEN 'WON'::"StageCategory" WHEN r < 0.27 THEN 'LOST'::"StageCategory" ELSE 'OPEN'::"StageCategory" END,
           CASE WHEN g % 3 = 0 THEN now() + interval '2 days' ELSE NULL END,
           CASE WHEN r < 0.12 THEN 25000 ELSE NULL END, CASE WHEN r < 0.12 THEN created + (g % 40) * interval '1 day' ELSE NULL END,
           CASE WHEN r >= 0.12 AND r < 0.27 THEN (ARRAY['PRICE','NO_RESPONSE','NOT_ELIGIBLE','BAD_TIMING'])[1 + (g % 4)] ELSE NULL END,
           now() - (g % 20) * interval '1 day', created + interval '30 minutes', created, created, created, 2, 1
    FROM (SELECT g, random() AS r, now() - (g % 180) * interval '1 day' - (g % 1440) * interval '1 minute' AS created FROM generate_series(1, ${LEADS}) g) s`);
  // calls: random lead, owner = lead owner
  await exec(`
    INSERT INTO call_logs (id, organization_id, lead_id, user_id, source, direction, outcome, started_at, duration_seconds, created_at)
    SELECT gen_random_uuid(), '${orgId}', l.id, coalesce(l.assigned_to_id, (${execArr})[1]), 'MANUAL', 'OUTBOUND',
           (ARRAY['CONNECTED','NO_ANSWER','NO_ANSWER','BUSY','SWITCHED_OFF','CALLBACK','FAILED','CONNECTED'])[1 + (s.g % 8)]::"CallOutcome",
           l.created_at + (s.g % 30) * interval '1 day' + (s.g % 600) * interval '1 minute', 30 + s.g % 300, l.created_at
    FROM (SELECT g, 1 + floor(random() * ${LEADS})::int AS pick FROM generate_series(1, ${CALLS}) g) s
    JOIN (SELECT id, assigned_to_id, created_at, row_number() OVER () AS rn FROM leads WHERE organization_id = '${orgId}') l ON l.rn = s.pick`);
  await exec(`
    INSERT INTO tasks (id, organization_id, lead_id, assigned_to_id, type, title, due_at, status, completed_at, priority, created_at, updated_at)
    SELECT gen_random_uuid(), '${orgId}', l.id, coalesce(l.assigned_to_id, (${execArr})[1]), (ARRAY['FOLLOW_UP','CALLBACK','CALL','DEMO','EMAIL'])[1 + (s.g % 5)]::"TaskType", 'Task',
           due, CASE WHEN s.g % 4 = 0 THEN 'OPEN' ELSE 'DONE' END::"TaskStatus", CASE WHEN s.g % 4 = 0 THEN NULL ELSE due - ((s.g % 7) - 2) * interval '1 hour' END, 'NORMAL', l.created_at, l.created_at
    FROM (SELECT g, 1 + floor(random() * ${LEADS})::int AS pick FROM generate_series(1, ${TASKS}) g) s
    JOIN (SELECT id, assigned_to_id, created_at, row_number() OVER () AS rn FROM leads WHERE organization_id = '${orgId}') l ON l.rn = s.pick
    CROSS JOIN LATERAL (SELECT l.created_at + (s.g % 120) * interval '1 day' AS due) d`);
  // deals + sales + credits + payments + refunds on WON leads
  await exec(`
    INSERT INTO deals (id, organization_id, lead_id, program_id, owner_id, stage, deal_type, amount, closed_at, created_by_id, created_at, updated_at, enrolments, version)
    SELECT gen_random_uuid(), '${orgId}', l.id, l.program_id, l.assigned_to_id, 'WON', 'NEW', 25000, l.won_at, l.assigned_to_id, l.created_at, l.created_at, 1, 1
    FROM leads l WHERE l.organization_id = '${orgId}' AND l.stage_category = 'WON' AND l.assigned_to_id IS NOT NULL AND l.program_id IS NOT NULL`);
  await exec(`
    INSERT INTO sales_records (id, organization_id, deal_id, lead_id, program_id, deal_type, sale_value, enrolments, closed_at, created_by_id)
    SELECT gen_random_uuid(), '${orgId}', d.id, d.lead_id, d.program_id, 'NEW', 25000, 1, d.closed_at, d.owner_id FROM deals d WHERE d.organization_id = '${orgId}' AND d.stage = 'WON'`);
  await exec(`INSERT INTO sales_credits (id, sales_record_id, organization_id, user_id, share_pct, amount) SELECT gen_random_uuid(), s.id, s.organization_id, d.owner_id, 100, 25000 FROM sales_records s JOIN deals d ON d.id = s.deal_id WHERE s.organization_id = '${orgId}'`);
  await exec(`
    INSERT INTO payments (id, organization_id, deal_id, owner_id, status, amount, provider, external_transaction_ref, verified_at, created_at, updated_at, version)
    SELECT gen_random_uuid(), '${orgId}', d.id, d.owner_id, CASE WHEN row_number() OVER () % 10 = 0 THEN 'RECORDED' ELSE 'VERIFIED' END::"PaymentStatus", 25000, 'MANUAL', gen_random_uuid()::text, d.closed_at + interval '2 days', d.closed_at, d.closed_at, 1 FROM deals d WHERE d.organization_id = '${orgId}'`);
  await exec(`
    INSERT INTO refunds (id, organization_id, deal_id, owner_id, status, amount, approved_amount, approved_at, reason_category, reason, requested_by_id, requested_at, version, created_at, updated_at)
    SELECT gen_random_uuid(), '${orgId}', d.id, d.owner_id, 'APPROVED', 5000, 5000, d.closed_at + interval '5 days', 'LEARNER_REQUEST', 'perf', d.owner_id, d.closed_at + interval '4 days', 1, d.closed_at, d.closed_at FROM (SELECT *, row_number() OVER () rn FROM deals WHERE organization_id = '${orgId}') d WHERE d.rn % 25 = 0`);
  // open pipeline deals
  await exec(`
    INSERT INTO deals (id, organization_id, lead_id, program_id, owner_id, stage, deal_type, amount, expected_close_on, created_by_id, created_at, updated_at, enrolments, version)
    SELECT gen_random_uuid(), '${orgId}', l.id, l.program_id, l.assigned_to_id, (ARRAY['OPEN','NEGOTIATION','PAYMENT_PENDING'])[1 + (row_number() OVER ())::int % 3]::"DealStage", 'NEW', 30000, current_date + 10, l.assigned_to_id, l.created_at, l.created_at, 1, 1
    FROM (SELECT * FROM leads WHERE organization_id = '${orgId}' AND stage_category = 'OPEN' AND assigned_to_id IS NOT NULL AND program_id IS NOT NULL LIMIT 3000) l`);
  // events + attendance
  await exec(`INSERT INTO events (id, organization_id, type, title, program_id, starts_at, status, created_at, updated_at) SELECT gen_random_uuid(), '${orgId}', (ARRAY['WEBINAR','DEMO'])[1 + g % 2]::"EventType", 'Event ' || g, (${progArr})[1 + g % 5], now() - g * interval '3 days', 'COMPLETED', now(), now() FROM generate_series(1, 60) g`);
  await exec(`
    INSERT INTO event_attendance (id, organization_id, event_id, lead_id, status, joined_at, source, created_at, updated_at)
    SELECT gen_random_uuid(), '${orgId}', e.id, l.id, 'ATTENDED', e.starts_at, 'MANUAL', now(), now()
    FROM (SELECT id, starts_at, row_number() OVER () rn FROM events WHERE organization_id = '${orgId}') e
    JOIN (SELECT id, row_number() OVER () rn FROM leads WHERE organization_id = '${orgId}' LIMIT 20000) l ON l.rn % 60 = e.rn % 60 WHERE l.rn <= 12000`);
  // targets for the current month
  const period = await prisma.targetPeriod.create({ data: { organizationId: orgId, type: 'MONTH', label: 'perf', startsOn: new Date(new Date().toISOString().slice(0, 8) + '01T00:00:00Z'), endsOn: new Date(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10) + 'T00:00:00Z') } });
  const root = await prisma.target.create({ data: { organizationId: orgId, periodId: period.id, metric: 'REVENUE', level: 'FOUNDER', ownerUserId: founder.id, amount: '50000000', originalAmount: '50000000', createdById: founder.id } });
  for (const m of managers) await prisma.target.create({ data: { organizationId: orgId, periodId: period.id, metric: 'REVENUE', level: 'MANAGER', ownerUserId: m, amount: '10000000', originalAmount: '10000000', parentId: root.id, createdById: founder.id } });
  await exec('ANALYZE');
  console.log(`[perf] dataset generated in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const time = async <T>(fn: () => Promise<T>): Promise<[number, T]> => {
  const s = performance.now();
  const r = await fn();
  return [performance.now() - s, r];
};

describe('analytics performance on a generated dataset', () => {
  const rows: Array<{ what: string; who: string; coldMs: number; medianMs: number }> = [];
  it('dataset size meets the requirement (>= 50k leads, >= 200k activities)', async () => {
    const [leads, calls, tasks] = await Promise.all([prisma.lead.count({ where: { organizationId: orgId } }), prisma.callLog.count({ where: { organizationId: orgId } }), prisma.task.count({ where: { organizationId: orgId } })]);
    console.log(`[perf] leads=${leads} calls=${calls} tasks=${tasks} activities=${calls + tasks}`);
    expect(leads).toBeGreaterThanOrEqual(50_000);
    expect(calls + tasks).toBeGreaterThanOrEqual(200_000);
  });

  it('measures every KPI (organisation scope and a manager scope)', async () => {
    const kpis = t.app.get(KpiService);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    for (const who of ['founder', 'manager'] as const) {
      for (const id of KPI_IDS) {
        const [cold] = await time(() => kpis.run(principals[who]!, id, { from, to }, { tile: true }));
        const warm: number[] = [];
        for (let i = 0; i < 3; i += 1) warm.push((await time(() => kpis.run(principals[who]!, id, { from, to }, { tile: true })))[0]);
        rows.push({ what: id, who, coldMs: Math.round(cold), medianMs: Math.round(median(warm)) });
      }
    }
  });

  it('measures dashboards, reports, reconciliation and a large report (export-sized)', async () => {
    const dash = t.app.get(DashboardsService);
    const reports = t.app.get(ReportsService);
    const recon = t.app.get(ReconciliationService);
    const q = {};
    const cases: Array<[string, string, () => Promise<unknown>]> = [
      ['dashboard founder', 'founder', () => dash.founder(principals.founder!, q)],
      ['dashboard team-lead', 'founder', () => dash.founder(principals.founder!, { ...q, period: 'WEEK' })],
      ['dashboard manager', 'manager', () => dash.manager(principals.manager!, q)],
      ['dashboard executive', 'executive', () => dash.executive(principals.executive!, q)],
      ['report follow-ups', 'founder', () => reports.run(principals.founder!, 'follow-ups', {})],
      ['report conversions (by source)', 'founder', () => reports.run(principals.founder!, 'conversions', { by: 'source' })],
      ['report funnel', 'founder', () => reports.run(principals.founder!, 'funnel', {})],
      ['report revenue (by owner)', 'founder', () => reports.run(principals.founder!, 'revenue', { by: 'owner' })],
      ['report team-performance', 'founder', () => reports.run(principals.founder!, 'team-performance', {})],
      ['report monthly-founder', 'founder', () => reports.run(principals.founder!, 'monthly-founder', {})],
      ['reconciliation (15 checks)', 'founder', () => recon.check(principals.founder!, {})],
    ];
    for (const [what, who, fn] of cases) {
      const [cold] = await time(fn);
      const warm: number[] = [];
      for (let i = 0; i < 3; i += 1) warm.push((await time(fn))[0]);
      rows.push({ what, who, coldMs: Math.round(cold), medianMs: Math.round(median(warm)) });
    }
  });

  it('prints the table and the query plans of the slowest statements', async () => {
    const sorted = [...rows].sort((a, b) => b.medianMs - a.medianMs);
    const table = ['| measurement | scope | cold ms | warm median ms |', '|---|---|---|---|', ...sorted.map((r) => `| ${r.what} | ${r.who} | ${r.coldMs} | ${r.medianMs} |`)].join('\n');
    console.log('\n' + table + '\n');
    writeFileSync(path.resolve(__dirname, 'last-run.md'), table + '\n');
    // capture statements while re-running the slowest KPIs, then EXPLAIN them
    const log = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [{ emit: 'event', level: 'query' }] });
    const seen: Array<{ query: string; params: string; ms: number }> = [];
    (log as unknown as { $on: (e: string, cb: (x: { query: string; params: string; duration: number }) => void) => void }).$on('query', (e) => seen.push({ query: e.query, params: e.params, ms: e.duration }));
    const kpis = t.app.get(KpiService);
    const swapped = kpis as unknown as { prisma: PrismaClient };
    const original = swapped.prisma;
    swapped.prisma = log;
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    for (const r of sorted.filter((x) => x.who === 'founder' && x.what.startsWith('KPI-')).slice(0, 6)) await kpis.run(principals.founder!, r.what, { from, to }, { tile: true });
    swapped.prisma = original;
    const slow = seen.filter((s) => /SELECT|WITH/i.test(s.query)).sort((a, b) => b.ms - a.ms).slice(0, 5);
    const plans: string[] = [];
    for (const s of slow) {
      try {
        const params = JSON.parse(s.params) as unknown[];
        const rowsOut = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ${s.query}`, ...params);
        plans.push(`-- ${s.ms} ms\n${s.query.slice(0, 400).replace(/\s+/g, ' ')}\n${rowsOut.map((r) => r['QUERY PLAN']).join('\n')}`);
      } catch (e) {
        plans.push(`-- ${s.ms} ms (EXPLAIN failed: ${(e as Error).message.slice(0, 120)})\n${s.query.slice(0, 300).replace(/\s+/g, ' ')}`);
      }
    }
    writeFileSync(path.resolve(__dirname, 'last-plans.txt'), plans.join('\n\n'));
    await log.$disconnect();
    console.log(plans.join('\n\n').slice(0, 6000));
    expect(rows.length).toBeGreaterThan(40);
  });
});
void Prisma;
