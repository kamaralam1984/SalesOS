import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  completeProbationReviewSchema, createExpectationSchema, createOnboardingPlanSchema, createOnboardingTemplateSchema, listOnboardingQuerySchema, updateOnboardingItemSchema,
} from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, forbidden, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { ensureCompetencies } from '../performance/competencies';
import { addDays, assertOrgUsers, assertTargetInScope, isoDay, scopeUserIds, todayUtc, toDate, userNameMap, asPage } from '../common/helpers';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

/** Acknowledgements are bound to the exact text: editing an expectation invalidates earlier acknowledgements. */
export const expectationHash = (e: { title: string; body: string; kind: string }) => createHash('sha256').update(`${e.kind}\n${e.title}\n${e.body}`).digest('hex');

/** Pure: progress of a checklist. */
export function checklistProgress(items: Array<{ status: string }>) {
  const total = items.length;
  const done = items.filter((i) => i.status === 'DONE').length;
  const skipped = items.filter((i) => i.status === 'SKIPPED').length;
  const denominator = total - skipped;
  return { total, done, skipped, pct: denominator <= 0 ? null : Math.round((done / denominator) * 100) };
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  // ---------------------------------------------------------------- templates
  async listTemplates(user: Principal) {
    return this.prisma.onboardingTemplate.findMany({ where: { organizationId: user.organizationId, isActive: true }, orderBy: [{ roleKey: 'asc' }, { name: 'asc' }, { id: 'asc' }], take: 100 });
  }

  async createTemplate(user: Principal, dto: Dto<typeof createOnboardingTemplateSchema>) {
    if (this.access.scopeLevel(user, 'onboarding:manage') !== 'org') throw forbidden('Templates are managed at organization level');
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.onboardingTemplate.create({ data: { organizationId: user.organizationId, roleKey: dto.roleKey, name: dto.name, items: dto.items, probationDays: dto.probationDays } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'onboarding.template_created', entityType: 'onboarding_template', entityId: t.id, metadata: { roleKey: dto.roleKey } });
      return t;
    });
  }

  // ---------------------------------------------------------------- plans
  private view(p: Prisma.OnboardingPlanGetPayload<{ include: { items: true } }>, names: Map<string, string>) {
    const today = todayUtc().getTime();
    return {
      id: p.id, employeeId: p.employeeId, employeeName: names.get(p.employeeId) ?? null, templateId: p.templateId, startDate: isoDay(p.startDate), status: p.status,
      progress: checklistProgress(p.items),
      items: p.items.sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0)).map((i) => ({
        id: i.id, title: i.title, category: i.category, description: i.description, dueDate: isoDay(i.dueDate), status: i.status, completedAt: i.completedAt, notes: i.notes, resourceId: i.resourceId,
        overdue: i.status === 'PENDING' && !!i.dueDate && i.dueDate.getTime() < today,
      })),
    };
  }

  async listPlans(user: Principal, q: Dto<typeof listOnboardingQuerySchema>) {
    const where = { ...(await this.access.scopedWhere(user, { permission: 'onboarding:view', ownerField: 'employeeId' })), ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.status ? { status: q.status } : {}) };
    const rows = await this.prisma.onboardingPlan.findMany({ where, include: { items: true }, orderBy: [{ startDate: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.map((p) => p.employeeId));
    return asPage(res, res.data.map((p) => this.view(p, names)));
  }

  async createPlan(user: Principal, dto: Dto<typeof createOnboardingPlanSchema>) {
    if (dto.employeeId === user.userId) throw forbidden('You cannot create your own onboarding plan');
    await assertOrgUsers(this.prisma, user.organizationId, [dto.employeeId]);
    await assertTargetInScope(this.access, user, 'onboarding:manage', dto.employeeId);
    const t = await this.prisma.onboardingTemplate.findFirst({ where: { id: dto.templateId, organizationId: user.organizationId, isActive: true } });
    if (!t) throw notFound('Template');
    const open = await this.prisma.onboardingPlan.findFirst({ where: { employeeId: dto.employeeId, status: 'ACTIVE' } });
    if (open) throw conflict('PLAN_EXISTS', 'This employee already has an active onboarding plan');
    const start = toDate(dto.startDate);
    const items = (t.items as Array<{ title: string; category?: string; dueDay?: number; description?: string; resourceId?: string }>).map((i) => ({
      organizationId: user.organizationId, title: i.title, category: (i.category ?? 'ONBOARDING') as 'ONBOARDING', description: i.description, dueDate: addDays(start, i.dueDay ?? 7), resourceId: i.resourceId,
    }));
    const id = await this.prisma.$transaction(async (tx) => {
      const p = await tx.onboardingPlan.create({ data: { organizationId: user.organizationId, employeeId: dto.employeeId, templateId: t.id, startDate: start, createdById: user.userId, items: { create: items } } });
      if (dto.scheduleProbation) {
        for (const day of t.probationDays) {
          await tx.probationReview.upsert({
            where: { employeeId_checkpointDay: { employeeId: dto.employeeId, checkpointDay: day } },
            update: {},
            create: { organizationId: user.organizationId, employeeId: dto.employeeId, checkpointDay: day, dueDate: addDays(start, day) },
          });
        }
      }
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'onboarding.plan_created', entityType: 'onboarding_plan', entityId: p.id, metadata: { employeeId: dto.employeeId, items: items.length, probationDays: dto.scheduleProbation ? t.probationDays : [] } });
      return p.id;
    });
    const row = await this.prisma.onboardingPlan.findUniqueOrThrow({ where: { id }, include: { items: true } });
    return this.view(row, await userNameMap(this.prisma, user.organizationId, [row.employeeId]));
  }

  async updateItem(user: Principal, itemId: string, dto: Dto<typeof updateOnboardingItemSchema>) {
    const item = await this.prisma.onboardingItem.findFirst({ where: { id: itemId, organizationId: user.organizationId }, include: { plan: true } });
    if (!item) throw notFound('Checklist item');
    const own = item.plan.employeeId === user.userId;
    if (own) {
      if (!this.access.has(user, 'onboarding:view')) throw notFound('Checklist item');
      if (dto.status === 'SKIPPED') throw forbidden('Only a manager can skip an item');
    } else {
      if (!this.access.has(user, 'onboarding:manage')) throw notFound('Checklist item');
      await assertTargetInScope(this.access, user, 'onboarding:manage', item.plan.employeeId, 'Checklist item');
    }
    if (item.plan.status !== 'ACTIVE') throw conflict('PLAN_CLOSED', 'The onboarding plan is closed');
    const done = await this.prisma.$transaction(async (tx) => {
      await tx.onboardingItem.update({ where: { id: itemId }, data: { status: dto.status, notes: dto.notes, completedAt: dto.status === 'DONE' ? new Date() : null, completedById: dto.status === 'DONE' ? user.userId : null } });
      const all = await tx.onboardingItem.findMany({ where: { planId: item.planId }, select: { status: true } });
      if (all.every((i) => i.status !== 'PENDING')) await tx.onboardingPlan.update({ where: { id: item.planId }, data: { status: 'COMPLETED' } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'onboarding.item_updated', entityType: 'onboarding_item', entityId: itemId, metadata: { employeeId: item.plan.employeeId, status: dto.status } });
      return all;
    });
    return { id: itemId, status: dto.status, progress: checklistProgress(done) };
  }

  // ---------------------------------------------------------------- probation
  async listProbation(user: Principal, q: Dto<typeof listOnboardingQuerySchema>) {
    const where = { ...(await this.access.scopedWhere(user, { permission: 'onboarding:view', ownerField: 'employeeId' })), ...(q.employeeId ? { employeeId: q.employeeId } : {}) };
    const rows = await this.prisma.probationReview.findMany({ where, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((r) => [r.employeeId, r.reviewerId]));
    const today = todayUtc().getTime();
    return asPage(res, res.data.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: names.get(r.employeeId) ?? null, checkpointDay: r.checkpointDay, dueDate: isoDay(r.dueDate), status: r.status, outcome: r.outcome, competencyScores: r.competencyScores, notes: r.notes, reviewerName: r.reviewerId ? names.get(r.reviewerId) ?? null : null, completedAt: r.completedAt, overdue: r.status === 'SCHEDULED' && r.dueDate.getTime() < today })));
  }

  async completeProbation(user: Principal, id: string, dto: Dto<typeof completeProbationReviewSchema>) {
    const ids = await scopeUserIds(this.access, user, 'onboarding:manage');
    const r = await this.prisma.probationReview.findFirst({ where: { id, organizationId: user.organizationId, ...(ids ? { employeeId: { in: ids } } : {}) } });
    if (!r) throw notFound('Probation review');
    if (r.employeeId === user.userId) throw forbidden('You cannot complete your own probation review');
    if (r.status !== 'SCHEDULED') throw conflict('ILLEGAL_TRANSITION', `Probation review is already ${r.status}`);
    if (Object.keys(dto.competencyScores).length) {
      const known = await ensureCompetencies(this.prisma, user.organizationId);
      if (Object.keys(dto.competencyScores).some((k) => !known.has(k))) throw new AppError('VALIDATION_ERROR', 'Unknown competency key', 400);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.probationReview.update({ where: { id }, data: { status: 'COMPLETED', outcome: dto.outcome, competencyScores: dto.competencyScores, notes: dto.notes, reviewerId: user.userId, completedAt: new Date() } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'probation.review_completed', entityType: 'probation_review', entityId: id, metadata: { employeeId: r.employeeId, checkpointDay: r.checkpointDay, outcome: dto.outcome } });
    });
    return { id, status: 'COMPLETED', outcome: dto.outcome };
  }

  // ---------------------------------------------------------------- ownership / accountability expectations
  async expectations(user: Principal, roleKey?: string) {
    const keys = roleKey ? [roleKey] : user.roles;
    const rows = await this.prisma.roleExpectation.findMany({ where: { organizationId: user.organizationId, isActive: true, roleKey: { in: keys } }, orderBy: [{ kind: 'asc' }, { title: 'asc' }, { id: 'asc' }], take: 100 });
    const acks = await this.prisma.roleExpectationAcknowledgement.findMany({ where: { organizationId: user.organizationId, userId: user.userId, expectationId: { in: rows.map((r) => r.id) } } });
    return rows.map((r) => {
      const hash = expectationHash(r);
      const ack = acks.find((a) => a.expectationId === r.id && a.contentHash === hash);
      return { ...r, acknowledgedByMe: !!ack, acknowledgedAt: ack?.acknowledgedAt ?? null, mustAcknowledge: user.roles.includes(r.roleKey as never) };
    });
  }

  /** The employee (holder of the role) acknowledges the CURRENT text. Idempotent; audited; never on behalf of someone else. */
  async acknowledgeExpectation(user: Principal, id: string) {
    const e = await this.prisma.roleExpectation.findFirst({ where: { id, organizationId: user.organizationId, isActive: true } });
    if (!e || !user.roles.includes(e.roleKey as never)) throw notFound('Expectation');
    const hash = expectationHash(e);
    const existing = await this.prisma.roleExpectationAcknowledgement.findUnique({ where: { expectationId_userId_contentHash: { expectationId: id, userId: user.userId, contentHash: hash } } });
    if (existing) return { id, acknowledged: true, acknowledgedAt: existing.acknowledgedAt, alreadyAcknowledged: true };
    return this.prisma.$transaction(async (tx) => {
      const ack = await tx.roleExpectationAcknowledgement.upsert({
        where: { expectationId_userId_contentHash: { expectationId: id, userId: user.userId, contentHash: hash } },
        update: {}, create: { organizationId: user.organizationId, expectationId: id, userId: user.userId, contentHash: hash },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'expectation.acknowledged', entityType: 'role_expectation', entityId: id, metadata: { kind: e.kind } });
      return { id, acknowledged: true, acknowledgedAt: ack.acknowledgedAt, alreadyAcknowledged: false };
    });
  }

  /** Who has acknowledged the current expectations (counts per expectation; names only for org-wide HR/Founder/Team Lead scope). */
  async expectationAdoption(user: Principal) {
    const level = this.access.scopeLevel(user, 'onboarding:view');
    if (level !== 'org' && level !== 'team') throw forbidden();
    const exps = await this.prisma.roleExpectation.findMany({ where: { organizationId: user.organizationId, isActive: true }, orderBy: [{ roleKey: 'asc' }, { kind: 'asc' }, { title: 'asc' }], take: 200 });
    const visible = level === 'org' ? null : (await this.access.visibleUsers(user)).ids;
    const out = [];
    for (const e of exps) {
      const audience = await this.prisma.user.findMany({
        where: { organizationId: user.organizationId, isActive: true, roleAssignments: { some: { role: { key: e.roleKey } } }, ...(visible ? { id: { in: visible } } : {}) },
        select: { id: true, name: true },
      });
      const acks = await this.prisma.roleExpectationAcknowledgement.findMany({ where: { expectationId: e.id, contentHash: expectationHash(e), userId: { in: audience.map((a) => a.id) } }, select: { userId: true } });
      const done = new Set(acks.map((a) => a.userId));
      out.push({ id: e.id, roleKey: e.roleKey, kind: e.kind, title: e.title, audience: audience.length, acknowledged: done.size, pending: audience.filter((a) => !done.has(a.id)).map((a) => ({ id: a.id, name: a.name })) });
    }
    return out;
  }

  async createExpectation(user: Principal, dto: Dto<typeof createExpectationSchema>) {
    if (this.access.scopeLevel(user, 'onboarding:manage') !== 'org') throw forbidden('Expectations are managed at organization level');
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.roleExpectation.create({ data: { organizationId: user.organizationId, createdById: user.userId, ...dto } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'expectation.created', entityType: 'role_expectation', entityId: e.id, metadata: { roleKey: dto.roleKey, kind: dto.kind } });
      return e;
    });
  }
}
