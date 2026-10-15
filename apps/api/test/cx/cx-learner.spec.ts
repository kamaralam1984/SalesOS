import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers';
import { buildCxFixture, buildOtherOrg, createLead, type CxFixture } from './helpers';

let t: TestApp;
let fx: CxFixture;
let other: Awaited<ReturnType<typeof buildOtherOrg>>;
beforeAll(async () => {
  t = await createTestApp();
  fx = await buildCxFixture(t);
  other = await buildOtherOrg(t);
});
afterAll(async () => { await t.close(); });

describe('relationship history', () => {
  it('aggregates lead timeline, calls, notes, complaints and escalations for the owner; hides private notes of others', async () => {
    const lead = fx.leadA.id;
    await t.prisma.leadNote.create({ data: { organizationId: fx.org.id, leadId: lead, authorId: fx.execA1.id, body: 'Shared: asked about EMI', visibility: 'SHARED' } });
    await t.prisma.leadNote.create({ data: { organizationId: fx.org.id, leadId: lead, authorId: fx.execA1.id, body: 'PRIVATE exec thought', visibility: 'PRIVATE' } });
    await t.prisma.callLog.create({ data: { organizationId: fx.org.id, leadId: lead, userId: fx.execA1.id, outcome: 'CONNECTED', startedAt: new Date(), notes: 'Discussed the AI Sprint' } });
    await t.prisma.leadStatusHistory.create({ data: { organizationId: fx.org.id, leadId: lead, oldStatus: 'NEW', newStatus: 'CONNECTED', newCategory: 'OPEN', changedById: fx.execA1.id } });
    expect((await fx.agents.execA1.post(`/cx/relationships/${lead}/notes`).send({ kind: 'PROMISE', body: 'Promised a 1:1 intro call with the mentor' })).status).toBe(201);
    await fx.agents.execA1.post('/cx/complaints').send({ leadId: lead, title: 'Class link not received', description: 'No link', category: 'DELIVERY_ACCESS', priority: 'P3' });
    const esc = await fx.agents.execA1.post('/cx/escalations').send({ leadId: lead, type: 'HIGH_VALUE', title: 'Corporate batch for 12 seats', context: 'Wants a custom invoice and EMI', blocker: 'Needs a discount approval', involveFounder: true });
    expect(esc.status, JSON.stringify(esc.body)).toBe(201);

    // open-task count uses the CRM TaskStatus enum (OPEN | DONE | CANCELLED): only OPEN tasks count
    const mkTask = (status: 'OPEN' | 'DONE' | 'CANCELLED', dueAt: Date) => t.prisma.task.create({ data: { organizationId: fx.org.id, leadId: lead, assignedToId: fx.execA1.id, type: 'FOLLOW_UP', title: `[TEST] ${status}`, dueAt, status } });
    await mkTask('OPEN', new Date(Date.now() - 86_400_000)); // overdue = OPEN with due_at in the past
    await mkTask('DONE', new Date());
    await mkTask('CANCELLED', new Date());
    const own = await fx.agents.execA1.get(`/cx/relationships/${lead}`);
    expect(own.status).toBe(200);
    expect(own.body.data.counts.openTasks).toBe(1);
    expect(own.body.data.mode).toBe('full');
    const types = own.body.data.timeline.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['LEAD_CREATED', 'STATUS_CHANGE', 'CALL', 'LEAD_NOTE', 'RELATIONSHIP_NOTE', 'COMPLAINT', 'ESCALATION']));
    const body = JSON.stringify(own.body.data.timeline);
    expect(body).toContain('asked about EMI');
    expect(body).toContain('PRIVATE exec thought'); // author sees own private note
    expect(own.body.data.counts.openComplaints).toBe(1);
    expect(own.body.data.counts.openEscalations).toBe(1);
    // chronological, newest first
    const times = own.body.data.timeline.map((e: { at: string }) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const mgr = await fx.agents.managerA.get(`/cx/relationships/${lead}`);
    expect(mgr.status).toBe(200);
    expect(JSON.stringify(mgr.body.data.timeline)).not.toContain('PRIVATE exec thought');
    expect((await fx.agents.teamLead.get(`/cx/relationships/${lead}`)).body.data.mode).toBe('full');
    // isolation
    expect((await fx.agents.execA2.get(`/cx/relationships/${lead}`)).status).toBe(404);
    expect((await fx.agents.managerB.get(`/cx/relationships/${lead}`)).status).toBe(404);
    expect((await other.agent.get(`/cx/relationships/${lead}`)).status).toBe(404);
    expect((await fx.agents.execA2.post(`/cx/relationships/${lead}/notes`).send({ body: 'sneaky' })).status).toBe(404);
    expect((await fx.agents.ss.post(`/cx/relationships/${lead}/notes`).send({ body: 'ss note' })).status).toBe(403);
  });

  it('key-prospect watchlist: per-user watch, stale signal, scoped, removable', async () => {
    const lead = await createLead(t.prisma, fx.org.id, fx.execA1, fx.teamA.id, { isKeyProspect: true, lastActivityAt: new Date(Date.now() - 5 * 86_400_000) });
    const flagged = await fx.agents.execA1.get('/cx/relationships/watchlist');
    const row = (flagged.body.data as Array<{ id: string; stale: boolean; watching: boolean }>).find((r) => r.id === lead.id)!;
    expect(row.stale).toBe(true); // key prospect untouched for 5 days
    expect(row.watching).toBe(false);
    const w = await fx.agents.execA1.post('/cx/relationships/watchlist').send({ leadId: fx.leadA.id, reason: 'Founder referral' });
    expect(w.status, JSON.stringify(w.body)).toBe(201);
    const after = (await fx.agents.execA1.get('/cx/relationships/watchlist')).body.data as Array<{ id: string; watching: boolean; watchReason: string }>;
    expect(after.find((r) => r.id === fx.leadA.id)).toMatchObject({ watching: true, watchReason: 'Founder referral' });
    expect(after.find((r) => r.id === fx.leadB.id)).toBeUndefined(); // other team's lead is out of scope
    expect((await fx.agents.execA1.post('/cx/relationships/watchlist').send({ leadId: fx.leadB.id })).status).toBe(404);
    expect(((await fx.agents.execA2.get('/cx/relationships/watchlist')).body.data as { id: string }[]).map((r) => r.id)).not.toContain(fx.leadA.id);
    expect((await fx.agents.execA1.delete(`/cx/relationships/watchlist/${fx.leadA.id}`)).status).toBe(200);
    expect((await fx.agents.execA1.delete(`/cx/relationships/watchlist/${fx.leadA.id}`)).status).toBe(404);
  });
});

describe('escalation workflow', () => {
  it('owner, blocker, Team Lead / Founder involvement and resolution, with illegal transitions refused', async () => {
    const create = await fx.agents.execA1.post('/cx/escalations').send({ leadId: fx.leadA.id, type: 'COMPLEX_CONVERSATION', title: 'Learner wants a custom payment plan', context: 'Asked for 8 instalments', blocker: 'Policy allows 3', requestedHelp: 'Approve exception' });
    expect(create.status, JSON.stringify(create.body)).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data.ownerName).toBe(fx.execA1.name);
    expect(create.body.data.teamLeadName).toBe(fx.managerA.name);
    const ev = await t.prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: id, eventType: 'escalation.raised' } });
    expect((ev.payload as { notifyRoles: string[] }).notifyRoles).toContain('SALES_TEAM_LEAD');
    const post = (to: string, extra: Record<string, unknown> = {}, a = fx.agents.teamLead) => a.post(`/cx/escalations/${id}/transition`).send({ to, ...extra });
    expect((await post('IN_REVIEW', {}, fx.agents.execA1)).status).toBe(403); // exec cannot start the review
    const rev = await post('IN_REVIEW', { involveFounder: true });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(rev.body.data.status).toBe('IN_REVIEW');
    expect(rev.body.data.founderInvolved).toBe(true);
    expect((await post('RESOLVED')).status).toBe(422); // resolution required
    expect((await post('OPEN')).status).toBe(409);
    const res = await post('RESOLVED', { resolution: 'Approved 5 instalments with Founder sign-off' });
    expect(res.body.data.status).toBe('RESOLVED');
    expect(res.body.data.resolvedAt).toBeTruthy();
    expect(res.body.data.history.map((h: { to: string }) => h.to)).toEqual(['OPEN', 'IN_REVIEW', 'RESOLVED']);
    for (const to of ['IN_REVIEW', 'CANCELLED', 'OPEN']) expect((await post(to, { reason: 'x' })).status, to).toBe(409);
    // visibility
    expect((await fx.agents.execA2.get(`/cx/escalations/${id}`)).status).toBe(404);
    expect((await fx.agents.managerB.get(`/cx/escalations/${id}`)).status).toBe(404);
    expect(((await fx.agents.managerA.get('/cx/escalations?status=RESOLVED')).body.data as { id: string }[]).map((x) => x.id)).toContain(id);
    expect((await other.agent.get(`/cx/escalations/${id}`)).status).toBe(404);
    expect((await fx.agents.execA1.post('/cx/escalations').send({ leadId: fx.leadB.id, type: 'HIGH_VALUE', title: 'cross team', context: 'abc' })).status).toBe(404);
  });
});

describe('satisfaction + enrolment experience capture', () => {
  it('captures CSAT with respondent reference, consent and timestamp; derives the score from template answers', async () => {
    const res = await fx.agents.execA1.post('/cx/satisfaction').send({ kind: 'CSAT', leadId: fx.leadA.id, answers: [{ questionId: 'overall', value: 4 }, { questionId: 'comment', value: 'Mentor was great' }], consentGiven: true, channel: 'PHONE' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ kind: 'CSAT', score: 4, consentGiven: true, channel: 'PHONE', leadId: fx.leadA.id });
    expect(res.body.data.respondentRef).toBe(`lead:${fx.leadA.id}`);
    expect(new Date(res.body.data.consentAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(res.body.data.respondedAt).toBeTruthy();
    // consent is mandatory
    expect((await fx.agents.execA1.post('/cx/satisfaction').send({ kind: 'CSAT', leadId: fx.leadA.id, score: 5, consentGiven: false })).status).toBe(400);
    expect((await fx.agents.execA1.post('/cx/satisfaction').send({ kind: 'CSAT', leadId: fx.leadA.id, score: 5 })).status).toBe(400);
    // range + type validation
    expect((await fx.agents.execA1.post('/cx/satisfaction').send({ kind: 'CSAT', leadId: fx.leadA.id, score: 9, consentGiven: true })).status).toBe(422);
    expect((await fx.agents.execA1.post('/cx/satisfaction').send({ kind: 'NPS', leadId: fx.leadA.id, answers: [{ questionId: 'recommend', value: 11 }], consentGiven: true })).status).toBe(422);
    expect((await fx.agents.execA1.post('/cx/satisfaction').send({ kind: 'CSAT', answers: [{ questionId: 'overall', value: 4 }], consentGiven: true })).status).toBe(422); // respondent reference needed
    expect((await fx.agents.execA1.post('/cx/satisfaction').send({ kind: 'CSAT', leadId: fx.leadB.id, score: 3, consentGiven: true })).status).toBe(404); // other team
    expect((await fx.agents.execA1.post('/cx/satisfaction').send({ kind: 'CSAT', leadId: fx.leadA.id, answers: [{ questionId: 'bogus', value: 4 }], consentGiven: true })).status).toBe(422);
    // anonymous external reference is allowed when consented
    const ext = await fx.agents.ss.post('/cx/satisfaction').send({ kind: 'NPS', respondentRef: 'survey-link-7781', score: 10, consentGiven: true });
    expect(ext.status, JSON.stringify(ext.body)).toBe(201);
  });

  it('enrolment-experience responses beyond 7 days are flagged and excluded from stats; low samples are flagged', async () => {
    const lead = await createLead(t.prisma, fx.org.id, fx.execA1, fx.teamA.id, { wonAt: new Date(Date.now() - 20 * 86_400_000), status: 'WON', stageCategory: 'WON' });
    const late = await fx.agents.execA1.post('/cx/satisfaction').send({ kind: 'ENROLMENT_EXPERIENCE', leadId: lead.id, answers: [{ questionId: 'overall', value: 2 }], consentGiven: true });
    expect(late.body.data.outsideWindow).toBe(true);
    const lead2 = await createLead(t.prisma, fx.org.id, fx.execA1, fx.teamA.id, { wonAt: new Date(Date.now() - 2 * 86_400_000), status: 'WON', stageCategory: 'WON' });
    const ok = await fx.agents.execA1.post('/cx/satisfaction').send({ kind: 'ENROLMENT_EXPERIENCE', leadId: lead2.id, answers: [{ questionId: 'overall', value: 5 }, { questionId: 'clarity', value: true }], consentGiven: true });
    expect(ok.body.data.outsideWindow).toBe(false);
    const stats = await fx.agents.teamLead.get('/cx/satisfaction/stats?kind=ENROLMENT_EXPERIENCE');
    const s = stats.body.data.summaries[0];
    expect(s.kind).toBe('ENROLMENT_EXPERIENCE');
    expect(s.excludedOutsideWindow).toBeGreaterThanOrEqual(1);
    expect(s.lowSample).toBe(true);
    const all = await fx.agents.founder.get('/cx/satisfaction/stats');
    expect(all.body.data.summaries.map((x: { kind: string }) => x.kind)).toEqual(['CSAT', 'NPS', 'ENROLMENT_EXPERIENCE']);
    const nps = all.body.data.summaries.find((x: { kind: string }) => x.kind === 'NPS');
    expect(nps.nps).toBe(100);
  });

  it('configurable survey templates: org template replaces the built-in; scores follow the rating question; scope applies to results', async () => {
    const builtin = await fx.agents.execA1.get('/cx/survey-templates');
    expect(builtin.body.data.every((x: { builtin: boolean }) => x.builtin)).toBe(true);
    expect((await fx.agents.execA1.post('/cx/survey-templates').send({ key: 'x-csat', name: 'Exec template', kind: 'CSAT', questions: [{ id: 'q', text: 'How was it?', type: 'RATING_1_5', required: true }] })).status).toBe(403);
    const bad = await fx.agents.founder.post('/cx/survey-templates').send({ key: 'bad-csat', name: 'No rating', kind: 'CSAT', questions: [{ id: 'q', text: 'Any comment?', type: 'TEXT', required: true }] });
    expect(bad.status).toBe(422);
    const tpl = await fx.agents.founder.post('/cx/survey-templates').send({ key: 'org-csat', name: 'Org CSAT', kind: 'CSAT', questions: [{ id: 'mentor', text: 'How helpful was your mentor?', type: 'RATING_1_5', required: true }, { id: 'again', text: 'Would you enrol again?', type: 'YES_NO', required: true }] });
    expect(tpl.status, JSON.stringify(tpl.body)).toBe(201);
    const list = (await fx.agents.execA1.get('/cx/survey-templates')).body.data as Array<{ kind: string; builtin: boolean; key: string }>;
    expect(list.find((x) => x.kind === 'CSAT' && !x.builtin)?.key).toBe('org-csat');
    expect(list.find((x) => x.kind === 'CSAT' && x.builtin)).toBeUndefined();
    const missing = await fx.agents.execA1.post('/cx/satisfaction').send({ templateId: tpl.body.data.id, leadId: fx.leadA.id, answers: [{ questionId: 'mentor', value: 3 }], consentGiven: true });
    expect(missing.status).toBe(422); // required "again" unanswered
    const good = await fx.agents.execA1.post('/cx/satisfaction').send({ templateId: tpl.body.data.id, leadId: fx.leadA.id, answers: [{ questionId: 'mentor', value: 3 }, { questionId: 'again', value: false }], consentGiven: true });
    expect(good.status, JSON.stringify(good.body)).toBe(201);
    expect(good.body.data.score).toBe(3);
    expect(good.body.data.templateVersion).toBe(1);
    // editing questions bumps the version but captured responses keep theirs
    const upd = await fx.agents.founder.patch(`/cx/survey-templates/${tpl.body.data.id}`).send({ questions: [{ id: 'mentor', text: 'Mentor helpfulness?', type: 'RATING_1_5', required: true }] });
    expect(upd.body.data.version).toBe(2);
    const stored = await t.prisma.satisfactionResponse.findUniqueOrThrow({ where: { id: good.body.data.id } });
    expect(stored.templateVersion).toBe(1);
    // results scope: exec sees own captures only, manager the team, SS + leaders all, marketing nothing
    const idsOf = async (a: typeof fx.agents.execA1) => ((await a.get('/cx/satisfaction?limit=100')).body.data as { id: string }[]).map((x) => x.id);
    expect(await idsOf(fx.agents.execA1)).toContain(good.body.data.id);
    expect(await idsOf(fx.agents.execA2)).not.toContain(good.body.data.id);
    expect(await idsOf(fx.agents.managerB)).not.toContain(good.body.data.id);
    expect(await idsOf(fx.agents.managerA)).toContain(good.body.data.id);
    expect(await idsOf(fx.agents.ss)).toContain(good.body.data.id);
    expect((await fx.agents.marketing.get('/cx/satisfaction')).status).toBe(403);
    expect((await other.agent.get('/cx/satisfaction')).body.data).toEqual([]);
  });
});

interface RefundV {
  id: string; status: string; learnerName: string | null; programName: string | null; minimumData: boolean; reason?: string;
  requested: { amount?: string; at: string | null; byName?: string | null };
  approved: { amount?: string | null; at: string | null; byName?: string | null };
  processed: { amount?: string | null; at: string | null; byName?: string | null };
  rootCause: { category: string } | null;
}

describe('refund tracking view (reads the revenue domain; no refund logic here)', () => {
  it('shows requested / approved / processed as separate facts, tags root causes, and derives like-for-like inputs', async () => {
    const lead = await createLead(t.prisma, fx.org.id, fx.execA1, fx.teamA.id, { programId: fx.program.id });
    const mkDeal = (amount: string) => t.prisma.deal.create({ data: { organizationId: fx.org.id, leadId: lead.id, programId: fx.program.id, ownerId: fx.execA1.id, teamId: fx.teamA.id, stage: 'WON', amount, closedAt: new Date(), createdById: fx.execA1.id } });
    const d1 = await mkDeal('20000.00');
    const d2 = await mkDeal('30000.00');
    for (const d of [d1, d2]) {
      await t.prisma.salesRecord.create({ data: { organizationId: fx.org.id, dealId: d.id, leadId: lead.id, programId: fx.program.id, dealType: 'NEW', saleValue: d.amount, enrolments: 1, closedAt: new Date(), createdById: fx.execA1.id } });
    }
    const requestedOnly = await t.prisma.refund.create({ data: { organizationId: fx.org.id, dealId: d1.id, ownerId: fx.execA1.id, teamId: fx.teamA.id, status: 'REQUESTED', amount: '5000.00', reasonCategory: 'LEARNER_REQUEST', reason: 'Changed mind', requestedById: fx.execA1.id } });
    const processed = await t.prisma.refund.create({ data: { organizationId: fx.org.id, dealId: d2.id, ownerId: fx.execA1.id, teamId: fx.teamA.id, status: 'PROCESSED', amount: '10000.00', approvedAmount: '8000.00', processedAmount: '8000.00', reasonCategory: 'MISSELLING', reason: 'Promise mismatch', requestedById: fx.execA1.id, approvedById: fx.founder.id, approvedAt: new Date(), processedById: fx.finance.id, processedAt: new Date(), externalRef: `X-${Date.now()}` } });
    const list = await fx.agents.execA1.get('/cx/refunds?limit=100');
    expect(list.status).toBe(200);
    const rows = list.body.data as RefundV[];
    const a = rows.find((r) => r.id === requestedOnly.id)!;
    const b = rows.find((r) => r.id === processed.id)!;
    expect(a.status).toBe('REQUESTED');
    expect(a.requested.amount).toBe('5000');
    expect(a.approved.at).toBeNull();
    expect(a.processed.at).toBeNull();
    expect(a.approved.amount ?? null).toBeNull();
    expect(b.requested.amount).toBe('10000'); // what was asked...
    expect(b.approved.amount).toBe('8000'); // ...is not what was approved...
    expect(b.processed.amount).toBe('8000'); // ...or processed
    expect(b.approved.byName).toBe(fx.founder.name);
    expect(b.processed.byName).toBe(fx.finance.name);
    expect(b.learnerName).toBe(lead.fullName);
    expect(b.programName).toBe(fx.program.name);
    // root cause
    const tag = await fx.agents.managerA.post(`/cx/refunds/${processed.id}/root-cause`).send({ category: 'MISLEADING_PROMISE', note: 'Seller promised placement support' });
    expect(tag.status, JSON.stringify(tag.body)).toBe(200);
    expect(tag.body.data.category).toBe('MISLEADING_PROMISE');
    expect((await fx.agents.managerB.post(`/cx/refunds/${processed.id}/root-cause`).send({ category: 'OTHER' })).status).toBe(404);
    expect((await fx.agents.execA1.post(`/cx/refunds/${processed.id}/root-cause`).send({ category: 'NOT_A_CAUSE' })).status).toBe(400);
    const after = ((await fx.agents.execA1.get('/cx/refunds?status=PROCESSED&limit=100')).body.data as RefundV[]).find((r) => r.id === processed.id)!;
    expect(after.rootCause?.category).toBe('MISLEADING_PROMISE');
    // like-for-like analytics inputs: requested-only is excluded from approved counts; unmatched approved reported
    const an = await fx.agents.founder.get(`/cx/refunds/analytics?programId=${fx.program.id}`);
    expect(an.status, JSON.stringify(an.body)).toBe(200);
    const cells = an.body.data.cells as Array<{ wonEnrolments: number; refundsRequested: number; refundsApproved: number; approvedValue: string; rate: number | null; cohortRate: number | null }>;
    const sum = (k: 'wonEnrolments' | 'refundsRequested' | 'refundsApproved') => cells.reduce((x, c) => x + c[k], 0);
    expect(sum('wonEnrolments')).toBeGreaterThanOrEqual(2);
    expect(sum('refundsRequested')).toBeGreaterThanOrEqual(2);
    expect(sum('refundsApproved')).toBeGreaterThanOrEqual(1);
    const cell = cells.find((c) => c.refundsApproved > 0)!;
    expect(Number(cell.approvedValue)).toBeGreaterThanOrEqual(8000);
    expect(cell.rate).toBeCloseTo(cell.refundsApproved / cell.wonEnrolments, 3);
    expect(an.body.data.rootCauses.find((c: { category: string }) => c.category === 'MISLEADING_PROMISE')?.count).toBeGreaterThanOrEqual(1);
    expect(an.body.data.method).toMatch(/like-for-like/);
    // isolation + data minimisation
    expect(((await fx.agents.execA2.get('/cx/refunds?limit=100')).body.data as { id: string }[]).map((r) => r.id)).not.toContain(processed.id);
    expect(((await other.agent.get('/cx/refunds')).body.data as unknown[])).toEqual([]);
    const ss = ((await fx.agents.ss.get('/cx/refunds?limit=100')).body.data as RefundV[]).find((r) => r.id === processed.id)!;
    expect(ss.minimumData).toBe(true);
    expect(ss.requested.amount).toBeUndefined(); // summary scope: no money
    expect(ss.reason).toBeUndefined();
    expect((await fx.agents.marketing.get('/cx/refunds')).status).toBe(403);
    expect((await fx.agents.hr.get('/cx/refunds')).status).toBe(403);
  });
});
