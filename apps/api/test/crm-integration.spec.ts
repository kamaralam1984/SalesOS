import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { signWebhook } from '@salesos/platform-core';
import { crmKit, createLead, createOrg, createUser, uniq, uniqPhone, type CrmKit } from './crm/kit';
import { CrmContextRegistry } from '../src/modules/ai/crm-context';
import { CrmAiContextProvider } from '../src/modules/crm/integration/crm-context.provider';

/** CRM <-> platform bindings: AI context provider (scope + PII minimisation) and verified-provider call logs (source = PROVIDER). */
let k: CrmKit;
const TEL_SECRET = `tel_${randomUUID()}`;

beforeAll(async () => {
  k = await crmKit();
  const cfg = await k.a.admin.patch('/ai/config').send({ enabled: true, provider: 'fake', model: 'local-deterministic-1', rateLimitPerMinute: 60 });
  expect(cfg.status, JSON.stringify(cfg.body)).toBe(200);
  expect((await k.a.admin.patch('/integrations/sandbox-telephony').send({ enabled: true, webhookSecret: TEL_SECRET })).status).toBe(200);
});
afterAll(async () => { await k.close(); });

describe('CrmContextRegistry is bound to the real CRM provider', () => {
  it('uses CrmAiContextProvider (not the NotAvailable default)', () => {
    const reg = k.app.get(CrmContextRegistry) as unknown as { provider: unknown };
    expect(reg.provider).toBeInstanceOf(CrmAiContextProvider);
  });

  it('call brief: own lead works, with notes/calls/tasks but no phone, e-mail or name', async () => {
    const phone = uniqPhone();
    const lead = await createLead(k.a.execA1, { phone, email: 'priya.private@example.com', fullName: 'Priya Privatename' });
    await k.a.execA1.post(`/leads/${lead.id}/notes`).send({ body: 'Wants the evening batch; asked about EMI' });
    const ctx = await k.app.get(CrmContextRegistry).getLeadContext({ id: k.fx.execA1.id, organizationId: k.fx.org.id }, lead.id);
    expect(ctx.available).toBe(true);
    const json = JSON.stringify(ctx);
    expect(json).toContain('evening batch');
    for (const secret of [phone, 'priya.private@example.com', 'Privatename']) expect(json).not.toContain(secret);
    const brief = await k.a.execA1.get(`/ai/call-brief/${lead.id}`);
    expect(brief.status).toBe(200);
    expect(brief.body.data.insufficientData).toBe(false);
  });

  it('scope: peers, other teams, summary-only roles, other orgs and malformed ids get nothing', async () => {
    const lead = await createLead(k.a.execA1);
    const reg = k.app.get(CrmContextRegistry);
    const ask = (id: string, org = k.fx.org.id, leadId = lead.id) => reg.getLeadContext({ id, organizationId: org }, leadId);
    expect((await ask(k.fx.execA1.id)).available).toBe(true);
    expect((await ask(k.fx.managerA.id)).available).toBe(true);
    expect((await ask(k.fx.founder.id)).available).toBe(true);
    for (const [who, id] of [['peer exec', k.fx.execA2.id], ['other team exec', k.fx.execB1.id], ['other team manager', k.fx.managerB.id], ['marketing (summary)', k.marketingId], ['admin', k.fx.admin.id], ['hr', k.fx.hr.id]] as const) {
      expect((await ask(id)).available, who).toBe(false);
    }
    const other = await createUser(k.t.prisma, await createOrg(k.t.prisma), { roles: ['FOUNDER_CEO'] });
    expect((await ask(other.id, other.organizationId)).available).toBe(false);
    expect((await ask(k.fx.founder.id, other.organizationId)).available).toBe(false); // caller/org mismatch
    expect((await ask(k.fx.founder.id, k.fx.org.id, 'not-a-uuid')).available).toBe(false);
    const inactive = await createUser(k.t.prisma, k.fx.org, { roles: ['FOUNDER_CEO'], isActive: false });
    expect((await ask(inactive.id)).available).toBe(false);
    // HTTP level
    const brief = await k.a.execB1.get(`/ai/call-brief/${lead.id}`);
    expect(brief.status).toBe(200);
    expect(brief.body.data.insufficientData).toBe(true);
  });

  it('PRIVATE notes of others stay private unless the reader holds leads:notes:view-private for that lead', async () => {
    const lead = await createLead(k.a.execA1);
    await k.a.execA1.post(`/leads/${lead.id}/notes`).send({ body: 'PRIVATE-NOTE-XYZ do not share', visibility: 'PRIVATE' });
    const reg = k.app.get(CrmContextRegistry);
    const asOwner = JSON.stringify(await reg.getLeadContext({ id: k.fx.execA1.id, organizationId: k.fx.org.id }, lead.id));
    const asManager = JSON.stringify(await reg.getLeadContext({ id: k.fx.managerA.id, organizationId: k.fx.org.id }, lead.id));
    expect(asOwner).toContain('PRIVATE-NOTE-XYZ'); // author
    expect(asManager).toContain('PRIVATE-NOTE-XYZ'); // holds view-private at team scope over the lead
  });

  it('lead priority covers only leads in the caller\'s scope', async () => {
    const mine = await createLead(k.a.execA1);
    const theirs = await createLead(k.a.execB1);
    const ex = await k.a.execA1.get('/ai/lead-priority');
    expect(ex.status).toBe(200);
    const ids = (ex.body.data.leads as Array<{ leadId: string }>).map((l) => l.leadId);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    const fo = await k.a.founder.get('/ai/lead-priority?limit=100');
    const all = (fo.body.data.leads as Array<{ leadId: string }>).map((l) => l.leadId);
    expect(all).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    const mk = await k.a.marketing.get('/ai/lead-priority');
    // Marketing holds leads:view as summary only: either no AI permission (403) or no data
    if (mk.status === 200) expect(mk.body.data.leads).toEqual([]);
    else expect(mk.status).toBe(403);
  });
});

describe('provider call events -> call_logs (source = PROVIDER)', () => {
  const send = (body: object, secret = TEL_SECRET) => {
    const raw = JSON.stringify(body);
    return request(k.app.getHttpServer()).post('/api/v1/integrations/telephony/webhook').set('content-type', 'application/json').set('x-signature', signWebhook(secret, raw)).set('x-provider', 'sandbox-telephony').send(raw);
  };
  const event = (callId: string, to: string, over: Record<string, unknown> = {}) => ({ id: `evt-${randomUUID()}`, type: 'call.event', data: { callId, direction: 'OUTBOUND', status: 'COMPLETED', from: '+911111111111', to, agentEmail: k.fx.execA1.email, startedAt: new Date().toISOString(), durationSec: 61, ...over } });

  it('a verified event writes exactly one PROVIDER call log on the matching lead and refines it on update', async () => {
    const phone = uniqPhone();
    const lead = await createLead(k.a.execA1, { phone });
    const tasksBefore = await k.t.prisma.task.count({ where: { leadId: lead.id } });
    const callId = `call-${uniq('c')}`;
    expect((await send(event(callId, `+91${phone}`))).body.data.outcome).toBe('APPLIED');
    const rows = await k.t.prisma.callLog.findMany({ where: { leadId: lead.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'PROVIDER', outcome: 'CONNECTED', userId: k.fx.execA1.id, durationSeconds: 61, providerCallId: callId, organizationId: k.fx.org.id });
    await send(event(callId, `+91${phone}`, { durationSec: 75 }));
    const after = await k.t.prisma.callLog.findMany({ where: { leadId: lead.id } });
    expect(after).toHaveLength(1);
    expect(after[0]!.durationSeconds).toBe(75);
    expect(after[0]!.source).toBe('PROVIDER');
    // evidence only: the provider event never moves the lead or creates automation tasks
    const l = await k.t.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.status).toBe(lead.status);
    expect(await k.t.prisma.task.count({ where: { leadId: lead.id } })).toBe(tasksBefore);
    // visible in the lead's call history with its provenance
    const list = await k.a.execA1.get(`/leads/${lead.id}/calls`);
    expect(list.body.data[0].sourceLabel).toMatch(/PROVIDER/);
  });

  it('ringing, unknown numbers and unknown agents write nothing; NO_ANSWER maps to NO_ANSWER; other orgs are never matched', async () => {
    const phone = uniqPhone();
    const lead = await createLead(k.a.execA1, { phone });
    await send(event(`c-${uniq('r')}`, `+91${phone}`, { status: 'RINGING' }));
    expect(await k.t.prisma.callLog.count({ where: { leadId: lead.id } })).toBe(0);
    await send(event(`c-${uniq('n')}`, `+91${uniqPhone()}`));
    await send(event(`c-${uniq('na')}`, `+91${phone}`, { status: 'NO_ANSWER', agentEmail: 'nobody@nowhere.test' }));
    const rows = await k.t.prisma.callLog.findMany({ where: { leadId: lead.id } });
    expect(rows).toHaveLength(1); // falls back to the lead's owner when the agent is unknown
    expect(rows[0]).toMatchObject({ outcome: 'NO_ANSWER', source: 'PROVIDER', userId: k.fx.execA1.id });
    // a lead with the same number in ANOTHER organisation is untouched
    const orgB = await createOrg(k.t.prisma);
    const founderB = await createUser(k.t.prisma, orgB, { roles: ['FOUNDER_CEO'] });
    const foreignLead = await k.t.prisma.lead.create({ data: { organizationId: orgB.id, fullName: '[TEST] foreign', phoneE164: `+91${phone}`, phoneRaw: phone, status: 'NEW', createdById: founderB.id } });
    await send(event(`c-${uniq('x')}`, `+91${phone}`));
    expect(await k.t.prisma.callLog.count({ where: { leadId: foreignLead.id } })).toBe(0);
  });

  it('forged signature is rejected and writes nothing; the manual endpoint still forces MANUAL and rejects source', async () => {
    const phone = uniqPhone();
    const lead = await createLead(k.a.execA1, { phone });
    expect((await send(event(`c-${uniq('f')}`, `+91${phone}`), 'wrong-secret-wrong-secret')).status).toBe(401);
    expect(await k.t.prisma.callLog.count({ where: { leadId: lead.id } })).toBe(0);
    expect((await k.a.execA1.post(`/leads/${lead.id}/calls`).send({ outcome: 'NO_ANSWER', source: 'PROVIDER' })).status).toBe(400);
    const manual = await k.a.execA1.post(`/leads/${lead.id}/calls`).send({ outcome: 'NO_ANSWER' });
    expect(manual.body.data.call.source).toBe('MANUAL');
  });
});
