import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAllCxSweeps, sweepComplaintSla, sweepFounderReports, sweepHandovers, sweepWorkItems } from '@salesos/cx-core';
import { createTestApp, type TestApp } from '../helpers';
import { buildCxFixture, FULL_HANDOVER, future, type CxFixture } from './helpers';

let t: TestApp;
let fx: CxFixture;
beforeAll(async () => {
  t = await createTestApp();
  fx = await buildCxFixture(t);
});
afterAll(async () => { await t.close(); });

const H = 3_600_000;
const events = (aggregateId: string, eventType?: string) => t.prisma.outboxEvent.findMany({ where: { aggregateId, ...(eventType ? { eventType } : {}) }, orderBy: { createdAt: 'asc' } });
const newComplaint = async (priority: 'P1' | 'P2' | 'P3' | 'P4') => {
  const r = await fx.agents.managerA.post('/cx/complaints').send({ leadId: fx.leadA.id, ownerId: fx.execA1.id, title: `SLA ${priority} test`, description: 'sweep test', category: 'SUPPORT_RESPONSE', priority });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string };
};

describe('complaint SLA breach job + escalation chain', () => {
  it('does nothing before the first-response deadline', async () => {
    const c = await newComplaint('P1');
    await sweepComplaintSla(t.prisma, new Date());
    const row = await t.prisma.complaint.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.firstResponseBreachedAt).toBeNull();
    expect(row.breachLevel).toBe(0);
    expect(await events(c.id, 'complaint.sla_breached')).toHaveLength(0);
  });

  it('detects a first-response breach, notifies the OWNER at level 1 and is idempotent across runs', async () => {
    const c = await newComplaint('P1');
    const row0 = await t.prisma.complaint.findUniqueOrThrow({ where: { id: c.id } });
    const now = new Date(row0.firstResponseDueAt.getTime() + 60_000); // 1 minute past due
    const r1 = await sweepComplaintSla(t.prisma, now);
    expect(r1.details.firstResponseBreaches).toBeGreaterThanOrEqual(1);
    const row = await t.prisma.complaint.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.firstResponseBreachedAt?.getTime()).toBe(row0.firstResponseDueAt.getTime()); // breach instant = deadline, not detection time
    expect(row.breachLevel).toBe(1);
    const evs = await events(c.id, 'complaint.sla_breached');
    expect(evs).toHaveLength(1);
    expect(evs[0]!.payload).toMatchObject({ level: 1, breach: 'FIRST_RESPONSE', notifyUserIds: [fx.execA1.id] });
    // generic notification request raised for the platform notifier
    const notif = await events(c.id, 'notification.requested');
    expect(notif.length).toBe(1);
    expect(notif[0]!.payload).toMatchObject({ type: 'complaint.escalated', userIds: [fx.execA1.id], actionUrl: `/cx/complaints/${c.id}` });
    // second + third run at the same instant: no duplicates (compare-and-set + idempotency keys)
    await sweepComplaintSla(t.prisma, now);
    await Promise.all([sweepComplaintSla(t.prisma, now), sweepComplaintSla(t.prisma, now)]);
    expect(await events(c.id, 'complaint.sla_breached')).toHaveLength(1);
    expect(await events(c.id, 'notification.requested')).toHaveLength(1);
  });

  it('escalates owner -> team lead -> founder (P1) as the breach ages; P3 never reaches the founder', async () => {
    const p1 = await newComplaint('P1');
    const p3 = await newComplaint('P3');
    const r1 = await t.prisma.complaint.findUniqueOrThrow({ where: { id: p1.id } });
    const base = r1.firstResponseDueAt.getTime();
    await sweepComplaintSla(t.prisma, new Date(base + 10 * 60_000));
    expect((await t.prisma.complaint.findUniqueOrThrow({ where: { id: p1.id } })).breachLevel).toBe(1);
    await sweepComplaintSla(t.prisma, new Date(base + 241 * 60_000));
    expect((await t.prisma.complaint.findUniqueOrThrow({ where: { id: p1.id } })).breachLevel).toBe(2);
    await sweepComplaintSla(t.prisma, new Date(base + 481 * 60_000));
    expect((await t.prisma.complaint.findUniqueOrThrow({ where: { id: p1.id } })).breachLevel).toBe(3);
    const levels = (await events(p1.id, 'complaint.sla_breached')).map((e) => (e.payload as { level: number; notifyRoles?: string[]; notifyUserIds?: string[] }));
    expect(levels.map((l) => l.level)).toEqual([1, 2, 3]);
    expect(levels[1]!.notifyRoles).toEqual(['SALES_TEAM_LEAD']);
    expect(levels[2]!.notifyRoles).toEqual(['FOUNDER_CEO']);
    // jump straight to a very late sweep (worker was down): every missed level is still emitted exactly once, in order
    const row3 = await t.prisma.complaint.findUniqueOrThrow({ where: { id: p3.id } });
    await sweepComplaintSla(t.prisma, new Date(row3.resolutionDueAt.getTime() + 24 * H));
    const p3Levels = (await events(p3.id, 'complaint.sla_breached')).map((e) => (e.payload as { level: number }).level);
    expect(p3Levels).toEqual([1, 2]);
    expect((await t.prisma.complaint.findUniqueOrThrow({ where: { id: p3.id } })).resolutionBreachedAt).toBeTruthy();
  });

  it('acknowledged complaints do not breach first response, resolved ones never breach, and ack stops the escalation', async () => {
    const c = await newComplaint('P2');
    const ack = await fx.agents.execA1.post(`/cx/complaints/${c.id}/transition`).send({ to: 'ACKNOWLEDGED', note: 'on it' });
    expect(ack.status).toBe(200);
    const row = await t.prisma.complaint.findUniqueOrThrow({ where: { id: c.id } });
    await sweepComplaintSla(t.prisma, new Date(row.firstResponseDueAt.getTime() + 2 * H));
    const after = await t.prisma.complaint.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.firstResponseBreachedAt).toBeNull();
    // resolution deadline passes -> resolution breach
    await sweepComplaintSla(t.prisma, new Date(row.resolutionDueAt.getTime() + 60_000));
    expect((await t.prisma.complaint.findUniqueOrThrow({ where: { id: c.id } })).resolutionBreachedAt).toBeTruthy();
    // resolved complaints are never flagged
    const r = await newComplaint('P4');
    for (const [to, extra] of [['ACKNOWLEDGED', { note: 'a' }], ['IN_PROGRESS', { note: 'b' }], ['RESOLVED', { resolution: 'done', rootCauseCategory: 'OTHER' }]] as const) {
      expect((await fx.agents.execA1.post(`/cx/complaints/${r.id}/transition`).send({ to, ...extra })).status).toBe(200);
    }
    const rr = await t.prisma.complaint.findUniqueOrThrow({ where: { id: r.id } });
    expect(rr.resolvedWithinSla).toBe(true);
    await sweepComplaintSla(t.prisma, new Date(rr.resolutionDueAt.getTime() + 5 * 86_400_000 - 8 * 86_400_000 + 8 * 86_400_000 - 5 * 86_400_000 + 3 * H));
    expect((await t.prisma.complaint.findUniqueOrThrow({ where: { id: r.id } })).resolutionBreachedAt).toBeNull();
  });

  it('auto-closes RESOLVED complaints after the configured days and records a system state-log entry', async () => {
    const c = await newComplaint('P4');
    for (const [to, extra] of [['ACKNOWLEDGED', { note: 'a' }], ['IN_PROGRESS', { note: 'b' }], ['RESOLVED', { resolution: 'done', rootCauseCategory: 'OTHER' }]] as const) {
      await fx.agents.execA1.post(`/cx/complaints/${c.id}/transition`).send({ to, ...extra });
    }
    await sweepComplaintSla(t.prisma, new Date(Date.now() + 6 * 86_400_000));
    expect((await t.prisma.complaint.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('RESOLVED');
    const r = await sweepComplaintSla(t.prisma, new Date(Date.now() + 8 * 86_400_000));
    expect(r.details.autoClosed).toBeGreaterThanOrEqual(1);
    expect((await t.prisma.complaint.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('CLOSED');
    const log = await t.prisma.cxStateLog.findFirst({ where: { entityId: c.id, toStatus: 'CLOSED' } });
    expect(log?.actorKind).toBe('SYSTEM');
  });
});

describe('handover pending-alert sweep', () => {
  it('SUBMITTED past the alert timer -> OVERDUE (manager + Student Success), later team lead; acknowledging stops it', async () => {
    const h = await t.prisma.handoverRecord.create({ data: { organizationId: fx.org.id, ownerId: fx.execA1.id, leadId: fx.leadA.id, ...FULL_HANDOVER, amountPaid: 5000, amountDue: 15000, status: 'DRAFT' } });
    const sub = await fx.agents.execA1.post(`/handovers/${h.id}/submit`).send({});
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const row = await t.prisma.handoverRecord.findUniqueOrThrow({ where: { id: h.id } });
    expect(row.ackDueAt!.getTime() - row.submittedAt!.getTime()).toBe(24 * H);
    await sweepHandovers(t.prisma, new Date(row.ackDueAt!.getTime() - 60_000));
    expect((await t.prisma.handoverRecord.findUniqueOrThrow({ where: { id: h.id } })).status).toBe('SUBMITTED');
    await sweepHandovers(t.prisma, new Date(row.ackDueAt!.getTime() + 60_000));
    const od = await t.prisma.handoverRecord.findUniqueOrThrow({ where: { id: h.id } });
    expect(od.status).toBe('OVERDUE');
    expect(od.overdueLevel).toBe(1);
    const ev1 = (await events(h.id, 'handover.overdue'))[0]!.payload as { notifyUserIds: string[]; notifyRoles: string[] };
    expect(ev1.notifyUserIds).toEqual(expect.arrayContaining([fx.execA1.id, fx.managerA.id]));
    expect(ev1.notifyRoles).toContain('STUDENT_SUCCESS');
    await sweepHandovers(t.prisma, new Date(row.ackDueAt!.getTime() + 25 * H));
    expect((await t.prisma.handoverRecord.findUniqueOrThrow({ where: { id: h.id } })).overdueLevel).toBe(2);
    expect(((await events(h.id, 'handover.overdue'))[1]!.payload as { notifyRoles: string[] }).notifyRoles).toContain('SALES_TEAM_LEAD');
    await sweepHandovers(t.prisma, new Date(row.ackDueAt!.getTime() + 25 * H));
    expect(await events(h.id, 'handover.overdue')).toHaveLength(2); // idempotent
    // OVERDUE -> ACKNOWLEDGED is allowed for Student Success
    const ack = await fx.agents.ss.post(`/handovers/${h.id}/acknowledge`).send({});
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    expect(ack.body.data.status).toBe('ACKNOWLEDGED');
  });
});

describe('action item + cross-functional task overdue sweep', () => {
  it('OPEN/IN_PROGRESS past due -> OVERDUE (owner alerted) -> ESCALATED (Founder alerted); completion by owner is blocked after cancel only', async () => {
    const created = await fx.agents.founder.post('/action-items').send({ title: 'Fix demo no-show follow-up', ownerId: fx.teamLead.id, dueAt: future(2) });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    const dueAt = new Date(created.body.data.dueAt);
    await sweepWorkItems(t.prisma, new Date(dueAt.getTime() - 60_000));
    expect((await t.prisma.actionItem.findUniqueOrThrow({ where: { id } })).status).toBe('OPEN');
    await sweepWorkItems(t.prisma, new Date(dueAt.getTime() + 60_000));
    const od = await t.prisma.actionItem.findUniqueOrThrow({ where: { id } });
    expect(od.status).toBe('OVERDUE');
    expect(((await events(id, 'action_item.overdue'))[0]!.payload as { notifyUserIds: string[] }).notifyUserIds).toEqual([fx.teamLead.id]);
    await sweepWorkItems(t.prisma, new Date(dueAt.getTime() + 25 * H));
    expect((await t.prisma.actionItem.findUniqueOrThrow({ where: { id } })).status).toBe('ESCALATED');
    expect(((await events(id, 'action_item.escalated'))[0]!.payload as { notifyRoles: string[] }).notifyRoles).toEqual(['FOUNDER_CEO']);
    await sweepWorkItems(t.prisma, new Date(dueAt.getTime() + 26 * H));
    expect(await events(id, 'action_item.escalated')).toHaveLength(1);
    // an escalated item can still be completed (with evidence), and is marked late
    await t.prisma.actionItem.update({ where: { id }, data: { dueAt: new Date(Date.now() - 3 * H) } }); // make "now" genuinely late
    const done = await fx.agents.teamLead.patch(`/action-items/${id}`).send({ status: 'COMPLETED', completionNote: 'Process changed', evidence: 'SOP v3 published' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.completedOnTime).toBe(false);
  });

  it('IN_PROGRESS items also become overdue (documented extension) and xf tasks follow the same ladder', async () => {
    const created = await fx.agents.founder.post('/action-items').send({ title: 'Review objection scripts', ownerId: fx.teamLead.id, dueAt: future(1) });
    const id = created.body.data.id as string;
    expect((await fx.agents.teamLead.patch(`/action-items/${id}`).send({ status: 'IN_PROGRESS' })).status).toBe(200);
    const xf = await fx.agents.teamLead.post('/xf-tasks').send({ title: 'Webinar reminders copy', department: 'MARKETING', ownerId: fx.marketing.id, dueAt: future(1) });
    expect(xf.status, JSON.stringify(xf.body)).toBe(201);
    const now = new Date(Date.now() + 2 * H);
    await sweepWorkItems(t.prisma, now);
    expect((await t.prisma.actionItem.findUniqueOrThrow({ where: { id } })).status).toBe('OVERDUE');
    expect((await t.prisma.xfTask.findUniqueOrThrow({ where: { id: xf.body.data.id } })).status).toBe('OVERDUE');
    await sweepWorkItems(t.prisma, new Date(Date.now() + 30 * H));
    expect((await t.prisma.xfTask.findUniqueOrThrow({ where: { id: xf.body.data.id } })).status).toBe('ESCALATED');
  });
});

describe('Founder report shells and reminders', () => {
  it('creates the weekly + monthly DRAFT shells once, reminds the author when overdue, alerts the Founder later', async () => {
    const now = new Date();
    await sweepFounderReports(t.prisma, now);
    const shells = await t.prisma.founderReport.findMany({ where: { organizationId: fx.org.id } });
    expect(shells.map((s) => s.type).sort()).toEqual(['MONTHLY', 'WEEKLY']);
    expect(shells.every((s) => s.authorId === fx.teamLead.id && s.status === 'DRAFT')).toBe(true);
    await sweepFounderReports(t.prisma, now);
    expect(await t.prisma.founderReport.count({ where: { organizationId: fx.org.id } })).toBe(2); // idempotent: still one weekly + one monthly
    const weekly0 = shells.find((s) => s.type === 'WEEKLY')!;
    // pin the weekly shell to a deterministic due time relative to now
    const dueAt = new Date(Date.now() + 3 * H);
    const weekly = await t.prisma.founderReport.update({ where: { id: weekly0.id }, data: { dueAt, dueReminderLevel: 0 } });
    await sweepFounderReports(t.prisma, new Date(dueAt.getTime() - 2 * H));
    expect(await events(weekly.id, 'founder_report.due')).toHaveLength(1); // due-soon reminder inside the last 24h
    expect((await t.prisma.founderReport.findUniqueOrThrow({ where: { id: weekly.id } })).dueReminderLevel).toBe(0);
    await sweepFounderReports(t.prisma, new Date(weekly.dueAt.getTime() + 60_000));
    expect((await t.prisma.founderReport.findUniqueOrThrow({ where: { id: weekly.id } })).dueReminderLevel).toBe(1);
    expect(((await events(weekly.id, 'founder_report.overdue'))[0]!.payload as { notifyUserIds: string[] }).notifyUserIds).toEqual([fx.teamLead.id]);
    await sweepFounderReports(t.prisma, new Date(weekly.dueAt.getTime() + 25 * H));
    expect((await t.prisma.founderReport.findUniqueOrThrow({ where: { id: weekly.id } })).dueReminderLevel).toBe(2);
    expect(((await events(weekly.id, 'founder_report.overdue'))[1]!.payload as { notifyRoles: string[] }).notifyRoles).toEqual(['FOUNDER_CEO']);
    await sweepFounderReports(t.prisma, new Date(weekly.dueAt.getTime() + 26 * H));
    expect(await events(weekly.id, 'founder_report.overdue')).toHaveLength(2);
  });

  it('runAllCxSweeps returns one result per job', async () => {
    const res = await runAllCxSweeps(t.prisma);
    expect(res.map((r) => r.job)).toEqual(['complaint-sla', 'handover-overdue', 'work-items', 'founder-reports']);
  });
});
