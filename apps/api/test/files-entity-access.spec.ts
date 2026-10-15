import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ObjectStorage, processFile, scannerFromEnv, storageConfigFromEnv } from '@salesos/platform-core';
import type { RoleKey } from '@salesos/shared-types';
import { createOrg, createUser, loginAgent, type AuthedAgent } from './helpers';
import { buildKit, collect, wonDeal, type RevenueKit } from './revenue/kit';
import { FileAccessRegistry } from '../src/modules/files/file-access.registry';
import { PermissionResolver } from '../src/common/authz/principal.loader';
import type { Principal } from '../src/common/authz';

/**
 * Files inherit the scope of the entity they are attached to (lead, deal, payment, refund, complaint, handover, sop_version,
 * review, candidate, onboarding, pip, founder_report); unregistered types fail closed; cross-team / cross-role / cross-org
 * downloads are refused.
 */
let k: RevenueKit;
let storage: ObjectStorage;
const registryUsers: Record<string, Principal> = {};
let reg: FileAccessRegistry;

const png = () => sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 120, b: 40 } } }).png().toBuffer();
const principalOf = async (userId: string, roles: RoleKey[]): Promise<Principal> => {
  const u = await k.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return { userId, organizationId: u.organizationId, email: u.email, name: u.name, managerId: u.managerId, roles, permissions: k.t.app.get(PermissionResolver).effective(roles), sessionId: 's', sessionFamilyId: 'f' };
};
const upload = (a: AuthedAgent, buf: Buffer, fields: Record<string, string> = {}) => {
  let r = a.post('/files');
  for (const [key, v] of Object.entries(fields)) r = r.field(key, v);
  return r.attach('file', buf, { filename: 'proof.png', contentType: 'image/png' });
};

let deal: { dealId: string; leadId: string };
let paymentId: string;
let refundId: string;
let foreign: AuthedAgent;
let marketing: AuthedAgent;
let ss: AuthedAgent;
let community: AuthedAgent;
let operations: AuthedAgent;

beforeAll(async () => {
  process.env.S3_BUCKET = 'salesos-agentj-test';
  k = await buildKit();
  storage = new ObjectStorage(storageConfigFromEnv());
  await storage.ensureBucket();
  reg = k.t.app.get(FileAccessRegistry);
  deal = await wonDeal(k);
  paymentId = await collect(k, deal.dealId);
  const r = await k.agents.managerA.post('/refunds').send({ dealId: deal.dealId, paymentId, amount: '12000.00', reasonCategory: 'LEARNER_REQUEST', reason: 'Learner asked to cancel' });
  refundId = r.body.data.id;
  const orgB = await createOrg(k.prisma);
  foreign = await loginAgent(k.t.app, await createUser(k.prisma, orgB, { roles: ['FOUNDER_CEO'] }));
  [marketing, ss, community, operations] = await Promise.all((['MARKETING', 'STUDENT_SUCCESS', 'COMMUNITY', 'OPERATIONS'] as RoleKey[]).map(async (role) => loginAgent(k.t.app, await createUser(k.prisma, k.fx.org, { roles: [role] }))));
});
afterAll(async () => { await k.close(); });

describe('registered resolvers', () => {
  it('every business entity type is attachable (registered) and unknown types are not', () => {
    for (const type of ['lead', 'deal', 'payment', 'refund', 'complaint', 'handover', 'sop_version', 'review', 'candidate', 'onboarding', 'pip', 'founder_report', 'xf_task', 'action_item', 'user']) expect(reg.has(type), type).toBe(true);
    expect(reg.has('call_recording')).toBe(false);
  });
});

describe('end-to-end downloads follow the entity scope', () => {
  const cases = () => [
    { type: 'lead', id: deal.leadId, uploader: k.agents.execA1, allow: { execA1: true, managerA: true, teamLead: true, founder: true, execA2: false, execB1: false, managerB: false, hr: false, admin: false, finance: false } },
    { type: 'deal', id: deal.dealId, uploader: k.agents.execA1, allow: { execA1: true, managerA: true, teamLead: true, founder: true, finance: true, execA2: false, execB1: false, managerB: false, hr: false, admin: false } },
    { type: 'payment', id: paymentId, uploader: k.agents.teamLead, allow: { teamLead: true, founder: true, finance: true, managerA: true, execA1: true, execB1: false, managerB: false, hr: false, admin: false } },
    { type: 'refund', id: refundId, uploader: k.agents.managerA, allow: { managerA: true, teamLead: true, founder: true, finance: true, execA1: true, execB1: false, managerB: false, hr: false, admin: false } },
  ] as const;

  for (const type of ['lead', 'deal', 'payment', 'refund']) {
    it(`${type}: allowed roles read, every other team/role/org is denied (404/403) and denied roles cannot attach`, async () => {
      const c = cases().find((x) => x.type === type)!;
      // uploaded with a purpose so the file is only reachable through the entity (the uploader keeps own access)
      const up = await upload(c.uploader, await png(), { entityType: c.type, entityId: c.id, purpose: 'payment_proof' });
      expect(up.status, JSON.stringify(up.body)).toBe(201);
      const id = up.body.data.id as string;
      expect((await processFile({ prisma: k.prisma, storage, scanner: scannerFromEnv() }, id)).status).toBe('READY');
      for (const [who, ok] of Object.entries(c.allow)) {
        const res = await k.agents[who as keyof typeof k.agents].get(`/files/${id}/download`);
        if (who === c.uploader.user.email) continue;
        expect(ok ? [200] : [403, 404], `${type}: ${who} -> ${res.status}`).toContain(res.status);
      }
      for (const [who, a] of [['marketing', marketing], ['studentSuccess', ss], ['community', community], ['operations', operations], ['foreign founder', foreign]] as const) {
        const res = await a.get(`/files/${id}/download`);
        expect([403, 404], `${type}: ${who} -> ${res.status}`).toContain(res.status);
        expect([403, 404], `${type}: ${who} download-url`).toContain((await a.get(`/files/${id}/download-url`)).status);
        const attach = await a.post(`/files/${id}/attach`).send({ entityType: c.type, entityId: c.id });
        expect([403, 404], `${type}: ${who} attach`).toContain(attach.status);
      }
      // a peer on another team cannot attach their own file to this entity
      const mine = await upload(k.agents.execB1, await png());
      expect((await k.agents.execB1.post(`/files/${mine.body.data.id}/attach`).send({ entityType: c.type, entityId: c.id })).status).toBe(404);
    });
  }

  it('Student Success (summary on deals/refunds/leads) never reads documents of those records', async () => {
    const up = await upload(k.agents.execA1, await png(), { entityType: 'deal', entityId: deal.dealId });
    expect([403, 404]).toContain((await ss.get(`/files/${up.body.data.id}`)).status);
    expect((await ss.get(`/files?entityType=deal&entityId=${deal.dealId}`)).status).toBe(404);
    expect((await marketing.get(`/files?entityType=lead&entityId=${deal.leadId}`)).status).toBe(404);
  });

  it('an unregistered entity type cannot be attached (fail closed)', async () => {
    const up = await upload(k.agents.execA1, await png());
    const res = await k.agents.execA1.post(`/files/${up.body.data.id}/attach`).send({ entityType: 'recording_secret', entityId: deal.dealId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ENTITY_TYPE_NOT_ATTACHABLE');
  });
});

describe('HR / CX / SOP resolvers (registry level, real rows)', () => {
  it('complaint, founder_report, sop_version, review, candidate, onboarding, pip', async () => {
    const { fx, prisma } = k;
    const orgId = fx.org.id;
    const day = new Date();
    const complaint = await prisma.complaint.create({ data: { organizationId: orgId, title: 'late', description: 'x', category: 'SERVICE', priority: 'P3', ownerId: fx.execA1.id, createdById: fx.execA1.id, teamId: fx.teamA.id, firstResponseDueAt: day, resolutionDueAt: day } });
    const report = await prisma.founderReport.create({ data: { organizationId: orgId, type: 'WEEKLY', periodStart: day, periodEnd: day, title: 'w', authorId: fx.teamLead.id, dueAt: day } });
    const sopDoc = await prisma.sopDocument.create({ data: { organizationId: orgId, category: 'LEAD_HANDLING', title: 'doc', ownerId: fx.teamLead.id, createdById: fx.teamLead.id } });
    const draft = await prisma.sopVersion.create({ data: { organizationId: orgId, documentId: sopDoc.id, versionNumber: 1, title: 'doc', body: 'b', createdById: fx.teamLead.id } });
    const review = await prisma.performanceReview.create({ data: { organizationId: orgId, employeeId: fx.execA1.id, reviewerId: fx.managerA.id, periodStart: day, periodEnd: day } });
    const req = await prisma.requisition.create({ data: { organizationId: orgId, title: 'r', roleKey: 'SALES_EXECUTIVE', hiringManagerId: fx.managerA.id, createdById: fx.hr.id } });
    const cand = await prisma.candidate.create({ data: { organizationId: orgId, requisitionId: req.id, name: 'C', createdById: fx.hr.id } });
    const onb = await prisma.onboardingPlan.create({ data: { organizationId: orgId, employeeId: fx.execA1.id, startDate: day, createdById: fx.hr.id } });
    const pip = await prisma.improvementPlan.create({ data: { organizationId: orgId, employeeId: fx.execA1.id, createdById: fx.teamLead.id, reason: 'r' } });

    const who: Record<string, [string, RoleKey[]]> = {
      execA1: [fx.execA1.id, ['SALES_EXECUTIVE']], execB1: [fx.execB1.id, ['SALES_EXECUTIVE']], managerA: [fx.managerA.id, ['SALES_MANAGER']], managerB: [fx.managerB.id, ['SALES_MANAGER']],
      teamLead: [fx.teamLead.id, ['SALES_TEAM_LEAD']], founder: [fx.founder.id, ['FOUNDER_CEO']], hr: [fx.hr.id, ['HR']], admin: [fx.admin.id, ['ADMIN']], finance: [fx.finance.id, ['FINANCE']],
    };
    for (const [name, [id, roles]] of Object.entries(who)) registryUsers[name] = await principalOf(id, roles);
    const read = async (type: string, entityId: string, name: string) => reg.can(type, { user: registryUsers[name]!, entityId, mode: 'read' });
    const attach = async (type: string, entityId: string, name: string) => reg.can(type, { user: registryUsers[name]!, entityId, mode: 'attach' });
    const matrix = async (type: string, entityId: string, expected: Record<string, boolean>) => {
      for (const [name, ok] of Object.entries(expected)) expect(await read(type, entityId, name), `${type} read by ${name}`).toBe(ok);
    };

    await matrix('complaint', complaint.id, { execA1: true, managerA: true, teamLead: true, founder: true, execB1: false, managerB: false, hr: false, admin: false, finance: false });
    await matrix('founder_report', report.id, { teamLead: true, founder: true, execA1: false, managerA: false, hr: false, admin: false, finance: false });
    await matrix('sop_version', draft.id, { teamLead: true, founder: true, execA1: false, managerA: false, hr: false, admin: false }); // unpublished draft: authors/approvers only
    await prisma.sopVersion.update({ where: { id: draft.id }, data: { status: 'APPROVED' } });
    await matrix('sop_version', draft.id, { teamLead: true, execA1: true, execB1: true, hr: true, admin: true });
    await matrix('review', review.id, { execA1: true, managerA: true, teamLead: true, founder: true, hr: true, execB1: false, managerB: false, admin: false, finance: false });
    await matrix('candidate', cand.id, { hr: true, founder: true, teamLead: true, execA1: false, execB1: false, managerA: false, admin: false, finance: false });
    await matrix('onboarding', onb.id, { execA1: true, managerA: true, hr: true, teamLead: true, execB1: false, managerB: false, admin: false, finance: false });
    await matrix('pip', pip.id, { execA1: true, managerA: true, hr: true, founder: true, execB1: false, managerB: false, admin: false, finance: false });
    // attach needs a write permission on the same record
    expect(await attach('review', review.id, 'execA1')).toBe(false);
    expect(await attach('review', review.id, 'managerA')).toBe(true);
    expect(await attach('candidate', cand.id, 'execA1')).toBe(false);
    expect(await attach('candidate', cand.id, 'hr')).toBe(true);
    expect(await attach('complaint', complaint.id, 'execB1')).toBe(false);
    // missing / foreign-org / malformed ids fail closed
    expect(await read('complaint', randomUUID(), 'founder')).toBe(false);
    expect(await read('review', 'not-a-uuid', 'founder')).toBe(false);
    const other = await createUser(prisma, await createOrg(prisma), { roles: ['FOUNDER_CEO'] });
    const foreignPrincipal = await principalOf(other.id, ['FOUNDER_CEO']);
    for (const [type, id] of [['complaint', complaint.id], ['review', review.id], ['candidate', cand.id], ['pip', pip.id], ['onboarding', onb.id], ['sop_version', draft.id], ['founder_report', report.id], ['lead', deal.leadId], ['deal', deal.dealId], ['payment', paymentId], ['refund', refundId]] as const) {
      expect(await reg.can(type, { user: foreignPrincipal, entityId: id, mode: 'read' }), `foreign org ${type}`).toBe(false);
    }
  });
});
