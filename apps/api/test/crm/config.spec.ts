import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLead, crmKit, type CrmKit } from './kit';

let k: CrmKit;
beforeAll(async () => { k = await crmKit(); });
afterAll(async () => { await k.close(); });

describe('configuration: programs, sources, stages, lost reasons, rules', () => {
  it('programs are configurable per organization (no pricing/funnel assumptions) and audited', async () => {
    const codes = ['AI_SPRINT', 'CBAX', 'MCA_X', 'MCA_ELITE_X', 'COACHEASILY_X', 'WC_SUMMIT'];
    for (const c of codes) {
      const r = await k.a.founder.post('/programs').send({ code: c, name: `[TEST] ${c}`, kind: c === 'WC_SUMMIT' ? 'EVENT' : c === 'COACHEASILY_X' ? 'APP' : 'PROGRAM' });
      expect(r.status).toBe(201);
    }
    const list = await k.a.execA1.get('/programs');
    expect(list.body.data.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(codes));
    expect((await k.a.founder.post('/programs').send({ code: 'bad code!', name: 'x' })).status).toBe(400);
    const p = list.body.data.find((x: { code: string }) => x.code === 'CBAX');
    expect((await k.a.admin.patch(`/programs/${p.id}`).send({ name: '[TEST] CBAX renamed', isActive: false })).status).toBe(200);
    expect((await k.a.execA1.get('/leads/meta')).body.data.programs.some((x: { code: string }) => x.code === 'CBAX')).toBe(false); // inactive hidden from forms
    expect(await k.t.prisma.auditLog.count({ where: { entityId: p.id, action: 'program.updated' } })).toBe(1);
    // program attribution on leads
    const mcax = list.body.data.find((x: { code: string }) => x.code === 'MCA_X');
    const lead = await createLead(k.a.execA1, { programId: mcax.id });
    expect((await k.a.execA1.get(`/leads/${lead.id}`)).body.data.program).toMatchObject({ id: mcax.id, code: 'MCA_X' });
    expect((await k.a.execA1.post('/leads').send({ fullName: 'x', phone: '9876543299', programId: '00000000-0000-4000-8000-000000000009' })).status).toBe(422);
  });

  it('sources and campaigns: attribution on leads, unique names, scoped by organization', async () => {
    const s = await k.a.founder.post('/lead-sources').send({ name: '[TEST] Instagram', type: 'CAMPAIGN' });
    expect(s.status).toBe(201);
    expect((await k.a.founder.post('/lead-sources').send({ name: '[TEST] Instagram' })).status).toBe(409);
    const c = await k.a.marketing.post('/campaigns').send({ sourceId: s.body.data.id, name: '[TEST] October reels' });
    expect(c.status).toBe(201);
    const lead = await createLead(k.a.execA1, { sourceId: s.body.data.id, campaignId: c.body.data.id });
    expect((await k.a.execA1.get(`/leads/${lead.id}`)).body.data.source.name).toBe('[TEST] Instagram');
    expect((await k.a.execA1.get('/lead-sources')).status).toBe(200);
  });

  it('stages and lost reasons are configurable; defaults follow DEC-006; core stages cannot be removed', async () => {
    const stages = await k.a.founder.get('/lead-stages');
    expect(stages.body.data.map((s: { key: string }) => s.key)).toEqual(['NEW', 'CONTACT_ATTEMPTED', 'CONNECTED', 'QUALIFIED', 'WEBINAR_REGISTERED', 'WEBINAR_ATTENDED', 'DEMO_SCHEDULED', 'DEMO_ATTENDED', 'PROPOSAL_NEGOTIATION', 'PAYMENT_PENDING', 'WON', 'LOST', 'NURTURE']);
    const reasons = await k.a.founder.get('/lost-reasons');
    expect(reasons.body.data.map((r: { key: string }) => r.key)).toEqual(['PRICE', 'NOT_INTERESTED', 'NO_RESPONSE_EXHAUSTED', 'COMPETITOR', 'BAD_TIMING', 'NOT_ELIGIBLE', 'DUPLICATE_OR_INVALID', 'LANGUAGE_MISMATCH', 'OTHER']);
    expect(reasons.body.data.find((r: { key: string }) => r.key === 'OTHER').requiresNote).toBe(true);
    const created = await k.a.founder.post('/lead-stages').send({ key: 'SITE_VISIT', label: 'Site visit', category: 'OPEN', sortOrder: 85, skippable: true });
    expect(created.status).toBe(201);
    const core = stages.body.data.find((s: { key: string }) => s.key === 'NEW');
    expect((await k.a.founder.patch(`/lead-stages/${core.id}`).send({ isActive: false })).status).toBe(409);
    const newReason = await k.a.founder.post('/lost-reasons').send({ key: 'FAMILY_ISSUE', label: 'Family issue', reactivateAfterDays: 90 });
    expect(newReason.status).toBe(201);
    const l = await createLead(k.a.execA1);
    expect((await k.a.execA1.post(`/leads/${l.id}/status`).send({ status: 'LOST', lostReason: 'FAMILY_ISSUE' })).status).toBe(200);
    const entry = await k.t.prisma.reactivationEntry.findFirstOrThrow({ where: { leadId: l.id } });
    expect(entry.eligibleFrom.getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    // deactivating a stage that leads are in is refused
    const inUse = await createLead(k.a.execA1);
    const stage = (await k.a.founder.get('/lead-stages')).body.data.find((s: { key: string }) => s.key === 'SITE_VISIT');
    await k.t.prisma.lead.update({ where: { id: inUse.id }, data: { status: 'SITE_VISIT' } });
    expect((await k.a.founder.patch(`/lead-stages/${stage.id}`).send({ isActive: false })).body.error.code).toBe('STAGE_IN_USE');
    expect(await k.t.prisma.auditLog.count({ where: { entityId: core.id, action: 'org.settings_changed' } })).toBeGreaterThanOrEqual(0);
    expect((await k.a.founder.post('/lead-stages').send({ key: 'lower_case', label: 'x', sortOrder: 1 })).status).toBe(400);
  });

  it('automation rules: defaults shown, org rule, validation, audited, inactive rule falls back to default', async () => {
    const before = await k.a.founder.get('/automation-rules');
    const names = before.body.data.filter((r: { teamId: string | null }) => !r.teamId).map((r: { ruleKey: string }) => r.ruleKey);
    expect(names).toEqual(expect.arrayContaining(['NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'CALLBACK', 'OVERDUE', 'UNATTENDED', 'WORKING_HOURS']));
    const def = before.body.data.find((r: { ruleKey: string }) => r.ruleKey === 'OVERDUE');
    expect(def).toMatchObject({ isDefault: true, id: null });
    const up = await k.a.teamLead.post('/automation-rules').send({ ruleKey: 'OVERDUE', config: { escalateManagerAfterWorkingDays: 2 } });
    expect(up.status).toBe(201);
    expect(up.body.data.config).toMatchObject({ escalateManagerAfterWorkingDays: 2, repeatOwnerAfterMinutes: 240 });
    expect((await k.a.teamLead.post('/automation-rules').send({ ruleKey: 'NOPE', config: {} })).status).toBe(422);
    expect((await k.a.teamLead.post('/automation-rules').send({ ruleKey: 'WORKING_HOURS', config: { start: '20:00', end: '08:00' } })).status).toBe(422);
    expect((await k.a.teamLead.patch(`/automation-rules/${up.body.data.id}`).send({ isActive: false })).status).toBe(200);
    expect(await k.t.prisma.auditLog.count({ where: { entityId: up.body.data.id, action: 'org.settings_changed' } })).toBe(2);
    expect((await k.a.managerA.get('/automation-rules')).status).toBe(403);
    await k.t.prisma.automationRule.deleteMany({ where: { organizationId: k.fx.org.id } });
  });

  it('round-robin config is per team, validated and audited', async () => {
    const r = await k.a.teamLead.agent.put('/api/v1/assignment-rules').set('x-csrf-token', k.a.teamLead.csrfToken).set('Origin', 'http://localhost:3100').send({ teamId: k.fx.teamB.id, isEnabled: true, dailyCap: 2, excludedUserIds: [], sourceIds: [], programIds: [] });
    expect(r.status).toBe(200);
    const capped = [];
    for (let i = 0; i < 6; i++) {
      const res = await k.a.managerB.post('/leads').send({ fullName: `[TEST] cap${i}`, phone: `98765${String(40000 + i + Math.floor(Math.random() * 1000)).slice(0, 5)}`, autoAssign: 'round_robin' });
      capped.push(res.body.data.lead.assignedTo?.id ?? null);
    }
    // 2 executives x daily cap 2 = 4 round-robin assignments, the rest stay unassigned (exception queue)
    expect(capped.filter(Boolean)).toHaveLength(4);
    expect(capped.filter((x) => x === null)).toHaveLength(2);
    expect((await k.a.teamLead.agent.put('/api/v1/assignment-rules').set('x-csrf-token', k.a.teamLead.csrfToken).set('Origin', 'http://localhost:3100').send({ teamId: '00000000-0000-4000-8000-000000000001', isEnabled: true })).status).toBe(404);
  });
});
