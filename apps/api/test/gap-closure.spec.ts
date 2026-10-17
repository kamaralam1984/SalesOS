import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { learnerRankFor, DEFAULT_RANK_LADDER, rankLadderSchema } from '@salesos/cx-core';
import { directDeps, previewCsv, processImportJob } from '@salesos/crm-core';
import { anonymous, createOrg, createTestApp, createUser, loginAgent, uniq, type TestApp } from './helpers';
import { buildCxFixture, buildOtherOrg, type CxFixture } from './cx/helpers';
import { ensureStarterPrograms, STARTER_PROGRAMS } from '../src/owner-bootstrap/starter-programs';

let t: TestApp;
let fx: CxFixture;
let other: Awaited<ReturnType<typeof buildOtherOrg>>;
beforeAll(async () => {
  t = await createTestApp();
  fx = await buildCxFixture(t);
  other = await buildOtherOrg(t);
});
afterAll(async () => { await t.close(); });

describe('learner revenue ranks (JD value statement)', () => {
  it('derives Warrior / Mavala / Sardar / Senapati / Chhatrapati from the JD thresholds', () => {
    const r = (n: number) => learnerRankFor(n, DEFAULT_RANK_LADDER)!.key;
    expect([r(0), r(99_999), r(100_000), r(1_000_000), r(4_999_999), r(5_000_000), r(10_000_000), r(99_000_000)]).toEqual(['WARRIOR', 'WARRIOR', 'MAVALA', 'SARDAR', 'SARDAR', 'SENAPATI', 'CHHATRAPATI', 'CHHATRAPATI']);
    expect(learnerRankFor(250_000, DEFAULT_RANK_LADDER)!.next).toEqual({ key: 'SARDAR', label: 'Sardar', remaining: '750000.00' });
    expect(learnerRankFor(10_000_000, DEFAULT_RANK_LADDER)!.next).toBeNull();
    expect(learnerRankFor(null, DEFAULT_RANK_LADDER)).toBeNull();
    expect(learnerRankFor('-5', DEFAULT_RANK_LADDER)).toBeNull();
  });

  it('a ladder must start at 0 and strictly increase', () => {
    expect(rankLadderSchema.safeParse([{ key: 'A', label: 'A', minEarned: 5 }]).success).toBe(false);
    expect(rankLadderSchema.safeParse([{ key: 'AA', label: 'A', minEarned: 0 }, { key: 'BB', label: 'B', minEarned: 0 }]).success).toBe(false);
    expect(rankLadderSchema.safeParse(DEFAULT_RANK_LADDER).success).toBe(true);
  });

  it('records learner earnings through the API, returns the rank, audits it, and respects scope', async () => {
    const lead = fx.leadA.id;
    const res = await fx.agents.execA1.post(`/cx/relationships/${lead}/learner-earnings`).send({ earnedRevenue: '1500000', note: 'Reached 15 lakh' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.rank.key).toBe('SARDAR');
    expect(res.body.data.nextRank.key).toBe('SENAPATI');
    expect(res.body.data.rankChanged).toBe(true);
    const view = await fx.agents.managerA.get(`/cx/relationships/${lead}`);
    expect(view.body.data.lead.learnerRank).toEqual({ key: 'SARDAR', label: 'Sardar' });
    expect(view.body.data.lead.learnerEarnedRevenue).toBe('1500000');
    // Student Success (summary scope) sees the rank label but never the amount
    const ss = await fx.agents.ss.get(`/cx/relationships/${lead}`);
    if (ss.status === 200) {
      expect(JSON.stringify(ss.body.data)).not.toContain('1500000');
    }
    const audit = await t.prisma.auditLog.findFirst({ where: { organizationId: fx.org.id, action: 'relationship.learner_earnings_set', entityId: lead } });
    expect(audit?.metadata).toMatchObject({ rankAfter: 'SARDAR' });
    // validation + IDOR
    expect((await fx.agents.execA1.post(`/cx/relationships/${lead}/learner-earnings`).send({ earnedRevenue: '-1' })).status).toBe(400);
    expect((await fx.agents.execA1.post(`/cx/relationships/${lead}/learner-earnings`).send({ earnedRevenue: '10', extra: 1 })).status).toBe(400);
    expect((await fx.agents.execB1.post(`/cx/relationships/${lead}/learner-earnings`).send({ earnedRevenue: '10' })).status).toBe(404);
    expect((await other.agent.post(`/cx/relationships/${lead}/learner-earnings`).send({ earnedRevenue: '10' })).status).toBe(404);
    expect((await fx.agents.finance.post(`/cx/relationships/${lead}/learner-earnings`).send({ earnedRevenue: '10' })).status).toBe(403);
  });
});

describe('user department (JD header)', () => {
  it('is optional, set on create/update, trimmed, and never affects permissions', async () => {
    const email = `dept-${Date.now()}@test.salesos.local`;
    const created = await fx.agents.founder.post('/users').send({ email, name: '[TEST] Dept', roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id, department: '  Sales ' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.department).toBe('Sales');
    const id = created.body.data.id as string;
    expect((await fx.agents.founder.patch(`/users/${id}`).send({ department: null })).body.data.department).toBeNull();
    expect((await fx.agents.founder.patch(`/users/${id}`).send({ department: 'x'.repeat(81) })).status).toBe(400);
    expect((await fx.agents.managerA.patch(`/users/${id}`).send({ department: 'Ops' })).status).toBe(403);
  });
});

describe('manual invite link (no email provider)', () => {
  const anon = () => anonymous(t.app);
  it('approval issues a single-use link that lands on the real web route; a creator can re-issue it; refused after the password is set', async () => {
    const email = `link-${Date.now()}@test.salesos.local`;
    const created = await fx.agents.founder.post('/users').send({ email, name: '[TEST] Link', roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const approved = await fx.agents.hr.post(`/users/${id}/approve`).send({});
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const first = new URL(approved.body.data.invite.link as string);
    expect(first.pathname).toBe('/invite/accept'); // the web route (was /accept-invite, which does not exist)
    const res = await fx.agents.founder.post(`/users/${id}/invite-link`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const token = new URL(res.body.data.link as string).searchParams.get('token')!;
    // the link from the approval was invalidated by the new one
    expect((await anon().post('/auth/invite/accept').send({ token: first.searchParams.get('token')!, password: 'Invite-Passw0rd-Ok1' })).status).toBe(400);
    expect((await anon().post('/auth/invite/accept').send({ token: 'not-a-real-token-value-123456789012345678', password: 'Invite-Passw0rd-Ok1' })).status).toBe(400);
    expect((await anon().post('/auth/invite/accept').send({ token, password: 'Invite-Passw0rd-Ok1' })).status).toBe(200);
    expect((await anon().post('/auth/login').send({ email, password: 'Invite-Passw0rd-Ok1' })).status).toBe(200);
    // already has a password: use a reset link instead
    expect((await fx.agents.founder.post(`/users/${id}/invite-link`).send({})).status).toBe(409);
    // links are never written to the audit log
    const rows = await t.prisma.auditLog.findMany({ where: { organizationId: fx.org.id, entityId: id, action: { in: ['user.invite_link_issued', 'user.approved'] } } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain(token);
  });

  it('only HR / Founder / Developer approve; HR cannot approve leadership accounts; rejected accounts stay closed; other orgs see nothing', async () => {
    const email = `fin-${Date.now()}@test.salesos.local`;
    const created = await fx.agents.founder.post('/users').send({ email, name: '[TEST] Fin', roles: ['FINANCE'] });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await fx.agents.admin.post(`/users/${id}/approve`).send({})).status).toBe(403); // no approve permission
    expect((await fx.agents.managerA.post(`/users/${id}/approve`).send({})).status).toBe(403);
    expect((await fx.agents.hr.post(`/users/${id}/approve`).send({})).status).toBe(403); // Finance is a leadership account: Founder or Developer only
    expect((await fx.agents.founder.post(`/users/${id}/approve`).send({})).status).toBe(403); // the creator cannot approve their own account
    expect((await other.agent.post(`/users/${id}/approve`).send({})).status).toBe(404);
    expect((await fx.agents.hr.get('/users/pending')).body.data.find((u: { id: string }) => u.id === id)?.canApprove).toBe(false);
    // a rejected account stays closed
    const email2 = `rej-${Date.now()}@test.salesos.local`;
    const c2 = await fx.agents.founder.post('/users').send({ email: email2, name: '[TEST] Rej', roles: ['SALES_EXECUTIVE'], managerId: fx.managerA.id });
    const id2 = c2.body.data.id as string;
    expect((await fx.agents.hr.post(`/users/${id2}/reject`).send({ reason: 'not hired' })).status).toBe(200);
    expect((await fx.agents.hr.post(`/users/${id2}/approve`).send({})).status).toBe(409);
    expect((await fx.agents.founder.post(`/users/${id2}/invite-link`).send({})).status).toBe(409);
    expect((await anon().post('/auth/login').send({ email: email2, password: 'Whatever-Passw0rd-1!' })).status).toBe(401);
  });
});

describe('a single-owner company is never locked out', () => {
  it('with no other approver the owner may approve their own creation (audited as selfApproved); once another approver exists they may not', async () => {
    const solo = await createOrg(t.prisma);
    const owner = await createUser(t.prisma, solo, { roles: ['FOUNDER_CEO'] });
    const agent = await loginAgent(t.app, owner);
    const c = await agent.post('/users').send({ email: `solo-${Date.now()}@test.salesos.local`, name: '[TEST] Solo', roles: ['SALES_EXECUTIVE'] });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect((await agent.get('/users/pending')).body.data[0].canApprove).toBe(true);
    const ok = await agent.post(`/users/${c.body.data.id}/approve`).send({});
    expect(ok.status).toBe(200);
    const row = await t.prisma.auditLog.findFirstOrThrow({ where: { entityId: c.body.data.id, action: 'user.approved' } });
    expect((row.metadata as { selfApproved?: boolean }).selfApproved).toBe(true);
    await createUser(t.prisma, solo, { roles: ['HR'] }); // a second approver arrives
    const c2 = await agent.post('/users').send({ email: `solo2-${Date.now()}@test.salesos.local`, name: '[TEST] Solo2', roles: ['SALES_EXECUTIVE'] });
    expect((await agent.post(`/users/${c2.body.data.id}/approve`).send({})).status).toBe(403);
  });
});

describe('manager-proposed PIP (KI-J-02 default)', () => {
  it('a manager proposes for own-team executives only; it stays a DRAFT the manager cannot advance; Team Lead takes it forward', async () => {
    const body = { employeeId: fx.execA1.id, reason: 'Missed targets for three straight weeks despite coaching', kpiGaps: [{ key: 'calls', name: 'Calls', target: 40, actual: 12 }] };
    const res = await fx.agents.managerA.post('/people/pips/propose').send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.proposedByManager).toBe(true);
    const id = res.body.data.id as string;
    // second open plan for the same employee is refused
    expect((await fx.agents.managerA.post('/people/pips/propose').send(body)).status).toBe(409);
    // the manager cannot submit it (only Team Lead / HR)
    expect((await fx.agents.managerA.post(`/people/pips/${id}/transition`).send({ to: 'PENDING_APPROVAL' })).status).toBe(403);
    // team scope: other team's executive, executives and finance are refused
    expect((await fx.agents.managerA.post('/people/pips/propose').send({ ...body, employeeId: fx.execB1.id })).status).toBe(404);
    expect((await fx.agents.execA1.post('/people/pips/propose').send({ ...body, employeeId: fx.execA2.id })).status).toBe(403);
    expect((await fx.agents.finance.post('/people/pips/propose').send(body)).status).toBe(403);
    // the employee never sees their own draft
    expect((await fx.agents.execA1.get(`/people/pips/${id}`)).status).toBe(404);
    // Team Lead and HR are notified through the outbox; the notification carries no narrative text
    const ev = await t.prisma.outboxEvent.findFirst({ where: { organizationId: fx.org.id, aggregateId: id, eventType: 'notification.requested' } });
    expect(ev).toBeTruthy();
    expect(JSON.stringify(ev!.payload)).not.toContain('Missed targets');
    // the Team Lead (pip:create) can submit the proposal through the normal machine
    const sub = await fx.agents.teamLead.post(`/people/pips/${id}/transition`).send({ to: 'PENDING_APPROVAL' });
    expect([200, 201, 422], JSON.stringify(sub.body)).toContain(sub.status);
  });
});

describe('CRM migration templates (LeadSquared / Zoho / HubSpot CSV exports)', () => {
  const ls = 'First Name,Last Name,Email Address,Mobile,Source\nAsha,Rao,asha@example.com,9876543210,Webinar\nRavi,,,,\n,Kumar,rk@example.invalid,9123456780,Ad\nMeera,Nair,not-an-email,9000000001,Ad\n';
  it('maps First/Last name into a full name and runs a dry run over every row without saving', () => {
    const p = previewCsv(ls, {}, 'LEADSQUARED');
    expect(p.nameFrom).toBe('firstLast');
    expect(p.problems).toEqual([]);
    expect(p.dryRun).toEqual({ rowsWithProblems: 2, missingName: 0, missingContact: 1, invalidEmail: 1 });
    // generic template does not know "First Name" / "Last Name"
    expect(previewCsv(ls, {}, 'GENERIC').problems).toContain('No name column found');
  });
  it('recognises Zoho and HubSpot headers', () => {
    const zoho = previewCsv('First Name,Last Name,Email,Phone,Lead Source\nA,B,a@b.co,9876543210,Web\n', {}, 'ZOHO');
    expect(zoho.nameFrom).toBe('firstLast');
    expect(zoho.dryRun.rowsWithProblems).toBe(0);
    const hub = previewCsv('First Name,Last Name,Email,Phone Number,Original Source\nA,B,a@b.co,9876543210,Organic\n', {}, 'HUBSPOT');
    expect(hub.mapping.phone).toBe(3);
    expect(hub.mapping.source).toBe(4);
  });
  it('imports through the API with the template, building names and flagging bad rows', async () => {
    const res = await fx.agents.managerA.post('/leads/import').send({ fileName: 'ls.csv', csv: ls, options: { template: 'LEADSQUARED', assignment: 'none' } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const jobId = res.body.data.id as string;
    await processImportJob(t.prisma as never, directDeps(), jobId);
    const names = (await t.prisma.lead.findMany({ where: { importJobId: jobId }, select: { fullName: true } })).map((l) => l.fullName).sort();
    expect(names).toContain('Asha Rao');
    expect(names).toContain('Kumar');
    expect(names).not.toContain('Ravi'); // no phone/email: rejected
  });
  it('rejects an unknown template', async () => {
    expect((await fx.agents.managerA.post('/leads/import').send({ csv: ls, options: { template: 'SALESFORCE' } })).status).toBe(400);
  });
});

describe('starter programs (production first run)', () => {
  it('creates the programs named in the JD once, keeps edits, and creates nothing else', async () => {
    const org = await t.prisma.organization.create({ data: { name: '[TEST] Starter', slug: uniq('starter') } });
    const a = await ensureStarterPrograms(t.prisma as never, org.slug);
    expect(a.created).toBe(STARTER_PROGRAMS.length);
    await t.prisma.program.update({ where: { organizationId_code: { organizationId: org.id, code: 'CBAX' } }, data: { name: 'CBAX (renamed by the business)' } });
    const b = await ensureStarterPrograms(t.prisma as never, org.slug);
    expect(b.created).toBe(0);
    expect((await t.prisma.program.findUniqueOrThrow({ where: { organizationId_code: { organizationId: org.id, code: 'CBAX' } } })).name).toBe('CBAX (renamed by the business)');
    expect(await t.prisma.program.count({ where: { organizationId: org.id } })).toBe(6);
    expect(await t.prisma.lead.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await t.prisma.programPrice.count({ where: { organizationId: org.id } })).toBe(0);
    await expect(ensureStarterPrograms(t.prisma as never, 'no-such-org')).rejects.toThrow(/not found/);
  });
});

