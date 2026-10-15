import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers';
import { seed } from '../../src/seed/seed';

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });

describe('[DEMO] CRM seed', () => {
  it('is idempotent, labels every record [DEMO], never fabricates verified calls and respects the lead invariant', async () => {
    await seed(t.prisma);
    const org = await t.prisma.organization.findUniqueOrThrow({ where: { slug: 'demo' } });
    const count = () => Promise.all([t.prisma.lead.count({ where: { organizationId: org.id } }), t.prisma.task.count({ where: { organizationId: org.id } }), t.prisma.callLog.count({ where: { organizationId: org.id } }), t.prisma.crmEvent.count({ where: { organizationId: org.id } }), t.prisma.program.count({ where: { organizationId: org.id } })]);
    const first = await count();
    await seed(t.prisma);
    expect(await count()).toEqual(first);
    expect(first[0]).toBeGreaterThanOrEqual(30);
    const leads = await t.prisma.lead.findMany({ where: { organizationId: org.id } });
    expect(leads.every((l) => l.fullName.startsWith('[DEMO]'))).toBe(true);
    expect(leads.filter((l) => l.createKey?.startsWith('demo:')).length).toBeGreaterThanOrEqual(30);
    expect((await t.prisma.program.findMany({ where: { organizationId: org.id } })).every((p) => p.name.startsWith('[DEMO]'))).toBe(true);
    expect((await t.prisma.crmEvent.findMany({ where: { organizationId: org.id } })).every((e) => e.title.startsWith('[DEMO]'))).toBe(true);
    expect((await t.prisma.callLog.findMany({ where: { organizationId: org.id } })).every((c) => c.source === 'MANUAL' && (c.notes ?? '').includes('[DEMO]'))).toBe(true);
    // every OPEN lead has an owner AND a next action, or is in the exception queue
    const open = leads.filter((l) => l.stageCategory === 'OPEN' && l.createKey?.startsWith('demo:')); // CRM-seeded leads only (other domains seed their own)
    const exc = new Set((await t.prisma.leadException.findMany({ where: { organizationId: org.id, resolvedAt: null } })).map((e) => e.leadId));
    for (const l of open) expect(!!l.assignedToId && !!l.nextActionAt || exc.has(l.id), l.fullName).toBe(true);
    expect(exc.size).toBeGreaterThanOrEqual(1); // the demo unowned lead
    expect(await t.prisma.duplicateCandidate.count({ where: { organizationId: org.id, status: 'OPEN' } })).toBeGreaterThanOrEqual(1);
    expect(await t.prisma.task.count({ where: { organizationId: org.id, status: 'OPEN', dueAt: { lt: new Date() } } })).toBeGreaterThanOrEqual(1); // overdue demo tasks
  });
});
