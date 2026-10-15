import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers';
import { buildCxFixture, buildOtherOrg, future, type CxFixture } from './helpers';

let t: TestApp;
let fx: CxFixture;
let other: Awaited<ReturnType<typeof buildOtherOrg>>;
beforeAll(async () => {
  t = await createTestApp();
  fx = await buildCxFixture(t);
  other = await buildOtherOrg(t);
});
afterAll(async () => { await t.close(); });

const sections = (over: Record<string, unknown> = {}) => ({
  performance: { narrative: 'Week closed with steady demo-to-sale follow-up. Manual commentary only.' },
  risks: { items: [{ title: 'Demo no-shows rising', description: 'Evening demos lose 30% attendance', severity: 3, proposedSolution: 'Add WhatsApp reminder 1h before and move demos to 7pm' }] },
  opportunities: { items: [{ title: 'Referral webinar', description: 'Alumni referral webinar for Elite program' }] },
  actionItems: { reviewed: true },
  ...over,
});

let periodN = 0;
/** distinct period per report so tests do not collide */
const newReport = async (type: 'WEEKLY' | 'MONTHLY' = 'WEEKLY', extra: Record<string, unknown> = {}) => {
  periodN += 1;
  const d = new Date(Date.UTC(2025, 0, 6 + 7 * periodN)); // distinct past Mondays
  const r = await fx.agents.teamLead.post('/founder-reports').send({ type, periodDate: d.toISOString().slice(0, 10), ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as { id: string; periodStart: string; dueAt: string; version: number };
};

describe('Founder report builder + publish', () => {
  it('creates a draft with period + due date; data sections carry real KPI metrics from the Phase 5 provider (a number that cannot be computed is null with its reason)', async () => {
    const r = await newReport();
    const got = (await fx.agents.teamLead.get(`/founder-reports/${r.id}`)).body.data;
    expect(got.status).toBe('DRAFT');
    expect(got.type).toBe('WEEKLY');
    expect(new Date(got.dueAt).getUTCDay()).toBe(1); // due Monday
    expect(got.dataSections.length).toBeGreaterThan(0);
    for (const s of got.dataSections) {
      // Phase 5 (analytics) replaced the pending placeholders: every metric names its KPI, and nothing is invented
      expect(s.status).toBe('AVAILABLE');
      expect(s.metrics.length).toBeGreaterThan(0);
      for (const m of s.metrics) {
        expect(m.kpiId).toMatch(/^KPI-/);
        expect(m.value === null || typeof m.value === 'string').toBe(true);
        expect(m.note).toMatch(/proposed default|not available/);
      }
    }
    expect(got.completenessPct).toBe(0);
    // creating the same period again returns the same draft
    const again = await fx.agents.teamLead.post('/founder-reports').send({ type: 'WEEKLY', periodDate: got.periodStart });
    expect(again.body.data.id).toBe(r.id);
  });

  it('blocks publish without a performance narrative and while any risk lacks a proposed solution', async () => {
    const r = await newReport();
    expect((await fx.agents.teamLead.post(`/founder-reports/${r.id}/submit`).send({})).status).toBe(422);
    const bad = await fx.agents.teamLead.patch(`/founder-reports/${r.id}`).send({ sections: sections({ risks: { items: [{ title: 'Pipeline thin for Elite' }, { title: 'Hiring gap', proposedSolution: 'Start sourcing' }] } }) });
    expect(bad.status).toBe(200);
    const res = await fx.agents.teamLead.post(`/founder-reports/${r.id}/submit`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('RISK_SOLUTION_REQUIRED');
    expect(res.body.error.message).toContain('Pipeline thin for Elite');
    expect((await t.prisma.founderReport.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('DRAFT');
    expect(await t.prisma.founderReportSnapshot.count({ where: { reportId: r.id } })).toBe(0);
  });

  it('publishes an immutable snapshot with a verifiable content hash, timeliness and completeness', async () => {
    const r = await newReport();
    await fx.agents.teamLead.patch(`/founder-reports/${r.id}`).send({ sections: sections() });
    const pub = await fx.agents.teamLead.post(`/founder-reports/${r.id}/submit`).send({});
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    const rep = pub.body.data;
    expect(rep.status).toBe('PUBLISHED');
    expect(rep.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rep.completenessPct).toBe(100);
    expect(rep.onTime).toBe(false); // period is in the past => published after its due time
    expect(rep.publishedAt).toBeTruthy();
    const snap = (await fx.agents.founder.get(`/founder-reports/${r.id}/snapshot`)).body.data;
    expect(snap.contentHash).toBe(rep.contentHash);
    expect(snap.integrityVerified).toBe(true);
    expect(snap.content.sections.risks.items[0].proposedSolution).toMatch(/WhatsApp/);
    expect(snap.content.dataSections[0].status).toBe('AVAILABLE');
    // idempotent publish: same hash, still one snapshot
    const again = await fx.agents.teamLead.post(`/founder-reports/${r.id}/submit`).send({});
    expect(again.status).toBe(200);
    expect(again.body.data.contentHash).toBe(rep.contentHash);
    expect(await t.prisma.founderReportSnapshot.count({ where: { reportId: r.id } })).toBe(1);
    // an unpublished report has no snapshot
    const draft = await newReport();
    expect((await fx.agents.teamLead.get(`/founder-reports/${draft.id}/snapshot`)).status).toBe(404);
  });

  it('published reports are IMMUTABLE at the API: edit attempts are rejected', async () => {
    const r = await newReport();
    await fx.agents.teamLead.patch(`/founder-reports/${r.id}`).send({ sections: sections() });
    const pub = (await fx.agents.teamLead.post(`/founder-reports/${r.id}/submit`).send({})).body.data;
    const edit = await fx.agents.teamLead.patch(`/founder-reports/${r.id}`).send({ title: 'Edited after publish', sections: sections({ performance: { narrative: 'rewritten history' } }) });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('REPORT_IMMUTABLE');
    const after = (await fx.agents.founder.get(`/founder-reports/${r.id}`)).body.data;
    expect(after.title).toBe(pub.title);
    expect(after.sections.performance.narrative).not.toBe('rewritten history');
    // creating "the same period" again is refused with a pointer to the correction flow
    const dup = await fx.agents.teamLead.post('/founder-reports').send({ type: 'WEEKLY', periodDate: pub.periodStart });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('REPORT_PUBLISHED');
  });

  it('published reports and snapshots are IMMUTABLE at the database (UPDATE/DELETE blocked by trigger)', async () => {
    const r = await newReport();
    await fx.agents.teamLead.patch(`/founder-reports/${r.id}`).send({ sections: sections() });
    await fx.agents.teamLead.post(`/founder-reports/${r.id}/submit`).send({});
    const snap = await t.prisma.founderReportSnapshot.findUniqueOrThrow({ where: { reportId: r.id } });
    await expect(t.prisma.founderReportSnapshot.update({ where: { id: snap.id }, data: { contentHash: 'tampered' } })).rejects.toThrow(/immutable/);
    await expect(t.prisma.founderReportSnapshot.update({ where: { id: snap.id }, data: { content: { forged: true } } })).rejects.toThrow(/immutable/);
    await expect(t.prisma.founderReportSnapshot.delete({ where: { id: snap.id } })).rejects.toThrow(/immutable/);
    await expect(t.prisma.$executeRawUnsafe(`UPDATE founder_report_snapshots SET on_time = true WHERE id = '${snap.id}'`)).rejects.toThrow(/immutable/);
    await expect(t.prisma.$executeRawUnsafe(`DELETE FROM founder_report_snapshots WHERE report_id = '${r.id}'`)).rejects.toThrow(/immutable/);
    // the report row itself is frozen too
    await expect(t.prisma.founderReport.update({ where: { id: r.id }, data: { sections: { performance: { narrative: 'rewritten' } } } })).rejects.toThrow(/immutable/);
    await expect(t.prisma.founderReport.update({ where: { id: r.id }, data: { status: 'DRAFT' } })).rejects.toThrow(/immutable/);
    await expect(t.prisma.founderReport.update({ where: { id: r.id }, data: { onTime: true } })).rejects.toThrow(/immutable/);
    await expect(t.prisma.founderReport.update({ where: { id: r.id }, data: { contentHash: 'x' } })).rejects.toThrow(/immutable/);
    await expect(t.prisma.founderReport.delete({ where: { id: r.id } })).rejects.toThrow(/published founder report/);
    // untouched
    const still = await t.prisma.founderReportSnapshot.findUniqueOrThrow({ where: { reportId: r.id } });
    expect(still.contentHash).toBe(snap.contentHash);
    // but the Founder review columns may change (they are not part of the snapshot)
    const rev = await fx.agents.founder.post(`/founder-reports/${r.id}/review`).send({ rating: 4, note: 'Clear risks, good solutions' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(rev.body.data.rating).toBe(4);
    expect((await t.prisma.founderReportSnapshot.findUniqueOrThrow({ where: { reportId: r.id } })).contentHash).toBe(snap.contentHash);
  });

  it('corrections are NEW versions that supersede the original; the original snapshot never changes; timeliness counts originals only', async () => {
    const r = await newReport();
    await fx.agents.teamLead.patch(`/founder-reports/${r.id}`).send({ sections: sections() });
    const v1 = (await fx.agents.teamLead.post(`/founder-reports/${r.id}/submit`).send({})).body.data;
    const nv = await fx.agents.teamLead.post(`/founder-reports/${r.id}/new-version`).send({});
    expect(nv.status, JSON.stringify(nv.body)).toBe(201);
    expect(nv.body.data.versionNumber).toBe(2);
    expect(nv.body.data.supersedesId).toBe(r.id);
    expect(nv.body.data.status).toBe('DRAFT');
    expect(nv.body.data.sections.performance.narrative).toBe(sections().performance.narrative); // seeded from v1
    // second call returns the open draft
    expect((await fx.agents.teamLead.post(`/founder-reports/${r.id}/new-version`).send({})).body.data.id).toBe(nv.body.data.id);
    await fx.agents.teamLead.patch(`/founder-reports/${nv.body.data.id}`).send({ sections: sections({ performance: { narrative: 'Corrected: demo attendance was 62%, not 70%.' } }) });
    const v2 = (await fx.agents.teamLead.post(`/founder-reports/${nv.body.data.id}/submit`).send({})).body.data;
    expect(v2.contentHash).not.toBe(v1.contentHash);
    expect(v2.onTime).toBe(v1.onTime); // inherits
    const snap1 = (await fx.agents.founder.get(`/founder-reports/${r.id}/snapshot`)).body.data;
    expect(snap1.contentHash).toBe(v1.contentHash);
    expect(snap1.content.sections.performance.narrative).toBe(sections().performance.narrative);
    expect((await fx.agents.founder.get(`/founder-reports/${nv.body.data.id}`)).body.data.versions.map((x: { versionNumber: number }) => x.versionNumber)).toEqual([1, 2]);
    // correcting a draft is not possible
    const d = await newReport();
    expect((await fx.agents.teamLead.post(`/founder-reports/${d.id}/new-version`).send({})).status).toBe(409);
  });

  it('timeliness metrics: only version-1 reports in the window; late/missing/on-time counted separately', async () => {
    const fx2 = await buildCxFixture(t); // fresh org so counts are exact
    const mk = async (periodStart: string, dueAt: Date, publishedAt: Date | null) => {
      const r = await t.prisma.founderReport.create({ data: { organizationId: fx2.org.id, type: 'WEEKLY', periodStart: new Date(periodStart), periodEnd: new Date(periodStart), authorId: fx2.teamLead.id, title: 'x', dueAt } });
      if (publishedAt) await t.prisma.$executeRawUnsafe(`UPDATE founder_reports SET status = 'PUBLISHED', published_at = '${publishedAt.toISOString()}', published_by_id = '${fx2.teamLead.id}', content_hash = 'h', on_time = ${publishedAt <= dueAt}, completeness_pct = 75 WHERE id = '${r.id}'`);
    };
    const now = Date.now();
    await mk('2026-08-03', new Date(now - 40 * 86_400_000), new Date(now - 41 * 86_400_000)); // on time
    await mk('2026-08-10', new Date(now - 33 * 86_400_000), new Date(now - 32 * 86_400_000)); // late
    await mk('2026-08-17', new Date(now - 26 * 86_400_000), null); // never published
    await mk('2026-08-24', new Date(now + 10 * 86_400_000), null); // not due yet
    const m = await fx2.agents.founder.get('/founder-reports/metrics');
    expect(m.status).toBe(200);
    expect(m.body.data.timeliness).toMatchObject({ due: 3, onTime: 1, late: 1, missing: 1, pct: 33.3 });
    expect(m.body.data.quality.meanCompletenessPct).toBe(75);
    expect((await other.agent.get('/founder-reports/metrics')).body.data.timeliness.due).toBe(0);
  });

  it('authorization: Founder reviews, Team Lead builds; managers/execs/others are denied; orgs are isolated', async () => {
    const r = await newReport();
    expect((await fx.agents.managerA.get('/founder-reports')).status).toBe(403);
    expect((await fx.agents.execA1.get(`/founder-reports/${r.id}`)).status).toBe(403);
    expect((await fx.agents.ss.post('/founder-reports').send({ type: 'WEEKLY' })).status).toBe(403);
    expect((await fx.agents.teamLead.post(`/founder-reports/${r.id}/review`).send({ rating: 5 })).status).toBe(403); // review is Founder-only
    expect((await fx.agents.founder.post(`/founder-reports/${r.id}/review`).send({ rating: 5 })).status).toBe(409); // draft cannot be reviewed
    expect((await fx.agents.founder.patch(`/founder-reports/${r.id}`).send({ title: 'x y z' })).status).toBe(200); // founder holds create too
    expect((await other.agent.get(`/founder-reports/${r.id}`)).status).toBe(404);
    expect((await other.agent.post(`/founder-reports/${r.id}/submit`).send({})).status).toBe(404);
    expect((await fx.agents.teamLead.get('/founder-reports?type=WEEKLY&status=DRAFT')).body.data.length).toBeGreaterThan(0);
  });
});

describe('risk register ("raise issues early with proposed solutions")', () => {
  it('records severity, early-warning flag and proposed solution; resolving needs a note; solution status is exposed', async () => {
    const c = await fx.agents.teamLead.post('/risk-register').send({ title: 'Collections slipping on EMI plans', description: 'Three EMI learners missed the second instalment', severity: 3, earlyWarning: true });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.data.hasSolution).toBe(false);
    expect(c.body.data.earlyWarning).toBe(true);
    const id = c.body.data.id as string;
    const upd = await fx.agents.teamLead.patch(`/risk-register/${id}`).send({ proposedSolution: 'Weekly EMI reminder call, escalate at day 3', status: 'MITIGATING' });
    expect(upd.body.data.hasSolution).toBe(true);
    expect((await fx.agents.teamLead.patch(`/risk-register/${id}`).send({ status: 'RESOLVED' })).status).toBe(422);
    const res = await fx.agents.teamLead.patch(`/risk-register/${id}`).send({ status: 'RESOLVED', resolutionNote: 'All three paid' });
    expect(res.body.data.resolvedAt).toBeTruthy();
    const list = await fx.agents.founder.get('/risk-register?status=RESOLVED');
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(id);
    expect((await fx.agents.managerA.get('/risk-register')).status).toBe(403);
    expect((await other.agent.get('/risk-register')).body.data).toEqual([]);
  });

  it('a register risk linked into a report is stamped with the report that carried it', async () => {
    const risk = (await fx.agents.teamLead.post('/risk-register').send({ title: 'Webinar capacity risk', description: 'Zoom cap is 500', severity: 2, proposedSolution: 'Upgrade licence' })).body.data;
    const r = await newReport();
    await fx.agents.teamLead.patch(`/founder-reports/${r.id}`).send({ sections: sections({ risks: { items: [{ title: risk.title, riskId: risk.id, proposedSolution: risk.proposedSolution }] } }) });
    await fx.agents.teamLead.post(`/founder-reports/${r.id}/submit`).send({});
    expect((await t.prisma.riskEntry.findUniqueOrThrow({ where: { id: risk.id } })).lastReportId).toBe(r.id);
  });
});

describe('action items (journey 12)', () => {
  const create = async (extra: Record<string, unknown> = {}) => {
    const r = await fx.agents.founder.post('/action-items').send({ title: 'Document the objection-handling SOP', ownerId: fx.teamLead.id, dueAt: future(48), ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data as { id: string };
  };

  it('full lifecycle with evidence, on-time flag, history and audit', async () => {
    const a = await create();
    const patch = (body: Record<string, unknown>, agent = fx.agents.teamLead) => agent.patch(`/action-items/${a.id}`).send(body);
    expect((await patch({ status: 'IN_PROGRESS' })).body.data.status).toBe('IN_PROGRESS');
    expect((await patch({ status: 'COMPLETED' })).status).toBe(422); // note + evidence required
    expect((await patch({ status: 'COMPLETED', completionNote: 'Published' })).status).toBe(422); // evidence still missing
    const done = await patch({ status: 'COMPLETED', completionNote: 'Published to SOP centre', evidence: 'SOP-OBJ v1 approved 14 Oct' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.completedOnTime).toBe(true);
    expect(done.body.data.history.map((h: { to: string }) => h.to)).toEqual(['OPEN', 'IN_PROGRESS', 'COMPLETED']);
    // COMPLETED is terminal
    for (const status of ['OPEN', 'IN_PROGRESS', 'CANCELLED', 'COMPLETED']) {
      const r = await patch({ status, cancelReason: 'x' });
      expect(r.status, status).toBe(409);
    }
    expect((await patch({ title: 'rename after completion' })).status).toBe(409);
    const audits = (await t.prisma.auditLog.findMany({ where: { entityType: 'action_item', entityId: a.id }, select: { action: true } })).map((x) => x.action);
    expect(audits).toEqual(expect.arrayContaining(['action_item.created', 'action_item.completed']));
    const ev = await t.prisma.outboxEvent.findFirst({ where: { aggregateId: a.id, eventType: 'action_item.completed' } });
    expect((ev!.payload as { notifyUserIds: string[] }).notifyUserIds).toEqual([fx.founder.id]);
  });

  it('illegal transitions are 409; only system sets OVERDUE/ESCALATED; cancel needs a reason; role/scope rules apply', async () => {
    const a = await create();
    const patch = (body: Record<string, unknown>, agent = fx.agents.teamLead) => agent.patch(`/action-items/${a.id}`).send(body);
    // OPEN->OVERDUE exists but is SYSTEM-only (403); OPEN->ESCALATED does not exist at all (409)
    expect((await patch({ status: 'OVERDUE' }, fx.agents.founder)).status).toBe(403);
    expect((await patch({ status: 'ESCALATED' }, fx.agents.founder)).status).toBe(409);
    expect((await patch({ status: 'CANCELLED' })).status).toBe(422);
    // an executive outside the owner/creator scope cannot see or change it
    expect((await patch({ status: 'IN_PROGRESS' }, fx.agents.execA1)).status).toBe(404);
    expect((await fx.agents.execA1.get(`/action-items/${a.id}`)).status).toBe(404);
    expect((await fx.agents.managerA.get(`/action-items/${a.id}`)).status).toBe(404);
    // exec cannot create items; SS/marketing have no access
    expect((await fx.agents.execA1.post('/action-items').send({ title: 'sneaky item', ownerId: fx.execA1.id, dueAt: future(5) })).status).toBe(403);
    expect((await fx.agents.ss.get('/action-items')).status).toBe(403);
    // past due dates and foreign owners are rejected
    expect((await fx.agents.founder.post('/action-items').send({ title: 'in the past', ownerId: fx.teamLead.id, dueAt: new Date(Date.now() - 86_400_000).toISOString() })).status).toBe(422);
    expect((await fx.agents.founder.post('/action-items').send({ title: 'foreign owner', ownerId: other.other.execA1.id, dueAt: future(5) })).status).toBe(400);
    const cancel = await patch({ status: 'CANCELLED', cancelReason: 'Superseded by new SOP' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('CANCELLED');
    expect((await patch({ status: 'COMPLETED', completionNote: 'x', evidence: 'y' })).status).toBe(409);
  });

  it('a manager sees their own team\'s items; owners see theirs; executives see only items they own', async () => {
    const mgr = await fx.agents.founder.post('/action-items').send({ title: 'Team A pipeline hygiene', ownerId: fx.managerA.id, dueAt: future(72) });
    const exec = await fx.agents.managerA.post('/action-items').send({ title: 'Clean up stale leads', ownerId: fx.execA1.id, dueAt: future(72) });
    expect(mgr.status).toBe(201);
    expect(exec.status, JSON.stringify(exec.body)).toBe(201);
    const ids = async (a: typeof fx.agents.execA1) => ((await a.get('/action-items?limit=100')).body.data as { id: string }[]).map((x) => x.id);
    expect(await ids(fx.agents.execA1)).toContain(exec.body.data.id);
    expect(await ids(fx.agents.execA1)).not.toContain(mgr.body.data.id);
    expect(await ids(fx.agents.execA2)).not.toContain(exec.body.data.id);
    expect(await ids(fx.agents.managerA)).toEqual(expect.arrayContaining([exec.body.data.id, mgr.body.data.id]));
    expect(await ids(fx.agents.managerB)).not.toContain(exec.body.data.id);
    // the executive completes their own item with evidence
    const done = await fx.agents.execA1.patch(`/action-items/${exec.body.data.id}`).send({ status: 'COMPLETED', completionNote: 'Cleaned 40 leads', evidence: 'CRM saved view link' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    // the executive cannot reassign it
    expect((await fx.agents.execA1.patch(`/action-items/${mgr.body.data.id}`).send({ ownerId: fx.execA1.id })).status).toBe(404);
  });

  it('completion metrics (KPI-FND-001 inputs): on-time completions / items due, cancelled excluded', async () => {
    const fx2 = await buildCxFixture(t);
    const mk = (title: string, dueAt: Date, status: string, completedAt: Date | null) => t.prisma.actionItem.create({ data: { organizationId: fx2.org.id, title, ownerId: fx2.teamLead.id, createdById: fx2.founder.id, dueAt, status: status as 'OPEN', completedAt, completedOnTime: completedAt ? completedAt <= dueAt : null } });
    const d = (days: number) => new Date(Date.now() + days * 86_400_000);
    await mk('on time', d(-5), 'COMPLETED', d(-6));
    await mk('late', d(-4), 'COMPLETED', d(-3));
    await mk('overdue', d(-3), 'OVERDUE', null);
    await mk('cancelled', d(-2), 'CANCELLED', null);
    await mk('future', d(20), 'OPEN', null);
    const m = await fx2.agents.founder.get('/action-items/metrics');
    expect(m.status).toBe(200);
    expect(m.body.data).toMatchObject({ due: 3, onTime: 1, pct: 33.3 });
    expect(m.body.data.byOwner[0]).toMatchObject({ ownerName: fx2.teamLead.name, due: 3, onTime: 1 });
    expect(m.body.data.overdue).toBeGreaterThanOrEqual(1);
  });
});
