import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crmKit, type CrmKit } from './kit';

let k: CrmKit;
beforeAll(async () => { k = await crmKit(); });
afterAll(async () => { await k.close(); });

const indexDefs = async (table: string) => (await k.t.prisma.$queryRawUnsafe<{ indexdef: string }[]>(`SELECT indexdef FROM pg_indexes WHERE tablename = '${table}'`)).map((r) => r.indexdef);

describe('required indexes (Blueprint s5) exist and the planner can use them', () => {
  it('leads(organization_id, assigned_to_id, status, created_at DESC)', async () => {
    expect((await indexDefs('leads')).some((d) => /\(organization_id, assigned_to_id, status, created_at DESC\)/.test(d))).toBe(true);
  });
  it('tasks(status, due_at, assigned_to_id) and call_logs(lead_id, created_at DESC)', async () => {
    expect((await indexDefs('tasks')).some((d) => /\(status, due_at, assigned_to_id\)/.test(d))).toBe(true);
    expect((await indexDefs('call_logs')).some((d) => /\(lead_id, created_at DESC\)/.test(d))).toBe(true);
  });
  it('query plans use the indexes for the hot queries (sequential scans disabled to prove usability on small tables)', async () => {
    const plan = async (sql: string) =>
      k.t.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${sql}`);
        return rows.map((r) => r['QUERY PLAN']).join('\n');
      });
    const org = k.fx.org.id;
    expect(await plan(`SELECT id FROM leads WHERE organization_id = '${org}' AND assigned_to_id = '${k.fx.execA1.id}' AND status = 'NEW' ORDER BY created_at DESC LIMIT 25`)).toMatch(/Index .*leads/);
    expect(await plan(`SELECT id FROM tasks WHERE status = 'OPEN' AND due_at < now() AND assigned_to_id = '${k.fx.execA1.id}'`)).toMatch(/Index .*tasks/);
    expect(await plan(`SELECT id FROM call_logs WHERE lead_id = '${k.fx.execA1.id}' ORDER BY created_at DESC LIMIT 10`)).toMatch(/Index .*call_logs/);
  });
  it('uniqueness guards that make retries safe exist (open queue entries, import rows, notification keys)', async () => {
    expect((await indexDefs('reassignment_queue')).some((d) => /UNIQUE.*\(open_key\)/.test(d))).toBe(true);
    expect((await indexDefs('leads')).some((d) => /UNIQUE.*\(organization_id, import_row_key\)/.test(d))).toBe(true);
    expect((await indexDefs('crm_notification_deliveries')).some((d) => /UNIQUE.*\(organization_id, idempotency_key\)/.test(d))).toBe(true);
    expect((await indexDefs('import_jobs')).some((d) => /UNIQUE.*\(organization_id, idempotency_key\)/.test(d))).toBe(true);
  });
});
