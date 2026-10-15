import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PEOPLE_EVENTS } from '@salesos/shared-types';
import type {
  acknowledgeReviewSchema, createKpiDefinitionSchema, createReviewSchema, listKpiAssignmentsQuerySchema, listReviewsQuerySchema, listScorecardsQuerySchema, updateReviewSchema, upsertKpiAssignmentSchema, upsertScorecardSchema,
} from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, forbidden, notFound } from '../../../common/http/errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { assertOrgUsers, assertTargetInScope, isoDay, mondayOf, scopeUserIds, toDate, userNameMap, asPage } from '../common/helpers';
import { DEFAULT_COMPETENCIES, ensureCompetencies } from './competencies';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  // ---------------------------------------------------------------- competencies
  async competencies(user: Principal) {
    let rows = await this.prisma.reviewRubric.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] });
    if (rows.length === 0) {
      await this.prisma.reviewRubric.createMany({
        data: DEFAULT_COMPETENCIES.map((c, i) => ({ organizationId: user.organizationId, key: c.key, name: c.name, description: c.description, indicators: c.indicators, sortOrder: i })),
        skipDuplicates: true,
      });
      rows = await this.prisma.reviewRubric.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] });
    }
    return rows.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, indicators: r.indicators, sortOrder: r.sortOrder, isActive: r.isActive }));
  }

  async updateCompetency(user: Principal, id: string, dto: { description?: string; isActive?: boolean }) {
    const r = await this.prisma.reviewRubric.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!r) throw notFound('Competency');
    await this.prisma.$transaction(async (tx) => {
      await tx.reviewRubric.update({ where: { id }, data: dto });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'competency.updated', entityType: 'review_rubric', entityId: id, metadata: { fields: Object.keys(dto) } });
    });
    return { id };
  }

  private async assertKnownCompetencies(orgId: string, scores: Record<string, number>) {
    const keys = Object.keys(scores);
    if (!keys.length) return;
    const known = await ensureCompetencies(this.prisma, orgId);
    const bad = keys.filter((k) => !known.has(k));
    if (bad.length) throw new AppError('VALIDATION_ERROR', `Unknown competency keys: ${bad.join(', ')}`, 400);
  }

  // ---------------------------------------------------------------- KPI definitions + assignments
  async listKpiDefinitions(user: Principal) {
    return this.prisma.kpiDefinition.findMany({ where: { organizationId: user.organizationId, isActive: true }, orderBy: [{ kind: 'asc' }, { name: 'asc' }, { id: 'asc' }], take: 200 });
  }

  async createKpiDefinition(user: Principal, dto: Dto<typeof createKpiDefinitionSchema>) {
    const dup = await this.prisma.kpiDefinition.findUnique({ where: { organizationId_key: { organizationId: user.organizationId, key: dto.key } } });
    if (dup) throw conflict('KPI_KEY_TAKEN', 'A KPI/KRA with this key already exists');
    return this.prisma.$transaction(async (tx) => {
      const d = await tx.kpiDefinition.create({ data: { organizationId: user.organizationId, ...dto } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'kpi_definition.created', entityType: 'kpi_definition', entityId: d.id, metadata: { key: d.key, kind: d.kind } });
      return d;
    });
  }

  private async assignmentView(user: Principal, rows: Prisma.KpiAssignmentGetPayload<object>[]) {
    const names = await userNameMap(this.prisma, user.organizationId, rows.flatMap((r) => [r.assigneeId, r.setById]));
    return rows.map((r) => ({ id: r.id, assigneeId: r.assigneeId, assigneeName: names.get(r.assigneeId) ?? null, weekStart: isoDay(r.weekStart), items: r.items, setById: r.setById, setByName: names.get(r.setById) ?? null, updatedAt: r.updatedAt }));
  }

  async listKpiAssignments(user: Principal, q: Dto<typeof listKpiAssignmentsQuerySchema>) {
    const where = { ...(await this.access.scopedWhere(user, { permission: 'kpi-assignments:view', ownerField: 'assigneeId' })), ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}), ...(q.weekStart ? { weekStart: toDate(q.weekStart) } : {}) };
    const rows = await this.prisma.kpiAssignment.findMany({ where, orderBy: [{ weekStart: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    return asPage(res, await this.assignmentView(user, res.data));
  }

  async upsertKpiAssignment(user: Principal, dto: Dto<typeof upsertKpiAssignmentSchema>) {
    if (dto.assigneeId === user.userId) throw forbidden('You cannot set your own KPI/KRA assignment');
    await assertOrgUsers(this.prisma, user.organizationId, [dto.assigneeId]);
    await assertTargetInScope(this.access, user, 'kpi-assignments:manage', dto.assigneeId);
    const week = mondayOf(toDate(dto.weekStart));
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.kpiAssignment.upsert({
        where: { assigneeId_weekStart: { assigneeId: dto.assigneeId, weekStart: week } },
        update: { items: dto.items, setById: user.userId },
        create: { organizationId: user.organizationId, assigneeId: dto.assigneeId, weekStart: week, items: dto.items, setById: user.userId },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'kpi_assignment.set', entityType: 'kpi_assignment', entityId: r.id, metadata: { assigneeId: dto.assigneeId, weekStart: isoDay(week), items: dto.items.length } });
      return r;
    });
    return (await this.assignmentView(user, [row]))[0]!;
  }

  // ---------------------------------------------------------------- scorecards (inputs only)
  async listScorecards(user: Principal, q: Dto<typeof listScorecardsQuerySchema>) {
    const where = { ...(await this.access.scopedWhere(user, { permission: 'scorecards:view', ownerField: 'subjectId' })), ...(q.subjectId ? { subjectId: q.subjectId } : {}), ...(q.periodType ? { periodType: q.periodType } : {}) };
    const rows = await this.prisma.scorecard.findMany({ where, orderBy: [{ periodStart: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((r) => [r.subjectId, r.createdById]));
    return asPage(res, res.data.map((r) => ({ id: r.id, subjectId: r.subjectId, subjectName: names.get(r.subjectId) ?? null, periodType: r.periodType, periodStart: isoDay(r.periodStart), periodEnd: isoDay(r.periodEnd), inputs: r.inputs, comments: r.comments, createdByName: names.get(r.createdById) ?? null, updatedAt: r.updatedAt })));
  }

  async upsertScorecard(user: Principal, dto: Dto<typeof upsertScorecardSchema>) {
    if (dto.periodEnd < dto.periodStart) throw new AppError('VALIDATION_ERROR', 'periodEnd must not precede periodStart', 400);
    await assertOrgUsers(this.prisma, user.organizationId, [dto.subjectId]);
    await assertTargetInScope(this.access, user, 'kpi-assignments:manage', dto.subjectId);
    const r = await this.prisma.$transaction(async (tx) => {
      const row = await tx.scorecard.upsert({
        where: { subjectId_periodType_periodStart: { subjectId: dto.subjectId, periodType: dto.periodType, periodStart: toDate(dto.periodStart) } },
        update: { inputs: dto.inputs, comments: dto.comments, periodEnd: toDate(dto.periodEnd) },
        create: { organizationId: user.organizationId, subjectId: dto.subjectId, periodType: dto.periodType, periodStart: toDate(dto.periodStart), periodEnd: toDate(dto.periodEnd), inputs: dto.inputs, comments: dto.comments, createdById: user.userId },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'scorecard.saved', entityType: 'scorecard', entityId: row.id, metadata: { subjectId: dto.subjectId } });
      return row;
    });
    return { id: r.id };
  }

  // ---------------------------------------------------------------- performance reviews
  private reviewView(user: Principal, r: Prisma.PerformanceReviewGetPayload<object>, names: Map<string, string>) {
    return {
      id: r.id, employeeId: r.employeeId, employeeName: names.get(r.employeeId) ?? null, reviewerId: r.reviewerId, reviewerName: names.get(r.reviewerId) ?? null,
      periodType: r.periodType, periodStart: isoDay(r.periodStart), periodEnd: isoDay(r.periodEnd), status: r.status, kpiSummary: r.kpiSummary, competencyScores: r.competencyScores,
      rating: r.rating, strengths: r.strengths, improvements: r.improvements, goals: r.goals, employeeComment: r.employeeComment,
      approvedByName: r.approvedById ? names.get(r.approvedById) ?? null : null, approvedAt: r.approvedAt, acknowledgedAt: r.acknowledgedAt, updatedAt: r.updatedAt,
      canEdit: r.reviewerId === user.userId && r.status === 'DRAFT',
    };
  }

  /** Employees (and anyone reading their own record) only see APPROVED/ACKNOWLEDGED reviews about themselves. */
  private async reviewWhere(user: Principal): Promise<Prisma.PerformanceReviewWhereInput> {
    const base = await this.access.scopedWhere(user, { permission: 'reviews:view', ownerField: 'employeeId' });
    return { AND: [base as Prisma.PerformanceReviewWhereInput, { OR: [{ employeeId: { not: user.userId } }, { status: { in: ['APPROVED', 'ACKNOWLEDGED'] } }] }] };
  }

  async listReviews(user: Principal, q: Dto<typeof listReviewsQuerySchema>) {
    const where: Prisma.PerformanceReviewWhereInput = { AND: [await this.reviewWhere(user), { ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.status ? { status: q.status } : {}) }] };
    const rows = await this.prisma.performanceReview.findMany({ where, orderBy: [{ periodStart: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((r) => [r.employeeId, r.reviewerId, r.approvedById]));
    return asPage(res, res.data.map((r) => this.reviewView(user, r, names)));
  }

  private async loadReview(user: Principal, id: string) {
    const r = await this.prisma.performanceReview.findFirst({ where: { AND: [await this.reviewWhere(user), { id }] } });
    if (!r) throw notFound('Review');
    return r;
  }

  async getReview(user: Principal, id: string) {
    const r = await this.loadReview(user, id);
    const names = await userNameMap(this.prisma, user.organizationId, [r.employeeId, r.reviewerId, r.approvedById]);
    return this.reviewView(user, r, names);
  }

  async createReview(user: Principal, dto: Dto<typeof createReviewSchema>) {
    if (dto.employeeId === user.userId) throw forbidden('You cannot review yourself');
    if (dto.periodEnd < dto.periodStart) throw new AppError('VALIDATION_ERROR', 'periodEnd must not precede periodStart', 400);
    await assertOrgUsers(this.prisma, user.organizationId, [dto.employeeId]);
    await assertTargetInScope(this.access, user, 'reviews:create', dto.employeeId);
    await this.assertKnownCompetencies(user.organizationId, dto.competencyScores);
    const dup = await this.prisma.performanceReview.findUnique({ where: { employeeId_periodType_periodStart: { employeeId: dto.employeeId, periodType: 'MONTH', periodStart: toDate(dto.periodStart) } } });
    if (dup) throw conflict('REVIEW_EXISTS', 'A review for this employee and period already exists');
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.performanceReview.create({
        data: {
          organizationId: user.organizationId, employeeId: dto.employeeId, reviewerId: user.userId, periodType: 'MONTH', periodStart: toDate(dto.periodStart), periodEnd: toDate(dto.periodEnd),
          kpiSummary: dto.kpiSummary, competencyScores: dto.competencyScores, rating: dto.rating, strengths: dto.strengths, improvements: dto.improvements, goals: dto.goals,
        },
      });
      for (const a of dto.actions) {
        await tx.coachingAction.create({ data: { organizationId: user.organizationId, ownerId: a.ownerId, title: a.title, dueDate: a.dueDate ? toDate(a.dueDate) : null, sourceRef: `review:${r.id}`, createdById: user.userId } });
      }
      await tx.peopleStateLog.create({ data: { organizationId: user.organizationId, entityType: 'review', entityId: r.id, fromStatus: null, toStatus: 'DRAFT', actorId: user.userId } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'review.created', entityType: 'performance_review', entityId: r.id, metadata: { employeeId: dto.employeeId } });
      const names = await userNameMap(this.prisma, user.organizationId, [r.employeeId, r.reviewerId]);
      return this.reviewView(user, r, names);
    });
  }

  async updateReview(user: Principal, id: string, dto: Dto<typeof updateReviewSchema>) {
    const r = await this.loadReview(user, id);
    if (r.reviewerId !== user.userId) throw forbidden('Only the reviewer can edit this review');
    if (r.status !== 'DRAFT') throw conflict('REVIEW_LOCKED', 'Only draft reviews can be edited');
    if (dto.competencyScores) await this.assertKnownCompetencies(user.organizationId, dto.competencyScores);
    await this.prisma.$transaction(async (tx) => {
      await tx.performanceReview.update({ where: { id }, data: dto });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'review.updated', entityType: 'performance_review', entityId: id, metadata: { fields: Object.keys(dto) } });
    });
    return this.getReview(user, id);
  }

  private async moveReview(user: Principal, r: { id: string; status: string; employeeId?: string }, to: 'SUBMITTED' | 'APPROVED' | 'ACKNOWLEDGED', data: Prisma.PerformanceReviewUncheckedUpdateManyInput, audit: string, event?: string) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.performanceReview.updateMany({ where: { id: r.id, status: r.status as never }, data: { ...data, status: to } });
      if (res.count !== 1) throw conflict('ILLEGAL_TRANSITION', 'Review state changed; reload and retry');
      await tx.peopleStateLog.create({ data: { organizationId: user.organizationId, entityType: 'review', entityId: r.id, fromStatus: r.status, toStatus: to, actorId: user.userId } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: audit, entityType: 'performance_review', entityId: r.id, metadata: { from: r.status, to } });
      if (event) await this.outbox.publish(tx, { eventType: event, aggregateType: 'performance_review', aggregateId: r.id, organizationId: user.organizationId, payload: { reviewId: r.id, to, actorId: user.userId, ...(r.employeeId ? { employeeId: r.employeeId } : {}) }, idempotencyKey: `${event}:${r.id}` });
    });
    return this.getReview(user, r.id);
  }

  async submitReview(user: Principal, id: string) {
    const r = await this.loadReview(user, id);
    if (r.reviewerId !== user.userId) throw forbidden('Only the reviewer can submit this review');
    if (r.status !== 'DRAFT') throw conflict('ILLEGAL_TRANSITION', `Cannot submit a ${r.status} review`);
    if (!r.rating || Object.keys(r.competencyScores as object).length === 0) throw new AppError('REVIEW_INCOMPLETE', 'Rating and competency scores are required before submitting', 422);
    return this.moveReview(user, r, 'SUBMITTED', {}, 'review.submitted', PEOPLE_EVENTS.REVIEW_SUBMITTED);
  }

  async approveReview(user: Principal, id: string) {
    const r = await this.loadReview(user, id);
    if (r.status !== 'SUBMITTED') throw conflict('ILLEGAL_TRANSITION', `Cannot approve a ${r.status} review`);
    if (r.reviewerId === user.userId) throw forbidden('The reviewer cannot approve their own review');
    if (r.employeeId === user.userId) throw forbidden('You cannot approve a review about yourself');
    return this.moveReview(user, r, 'APPROVED', { approvedById: user.userId, approvedAt: new Date() }, 'review.approved', PEOPLE_EVENTS.REVIEW_APPROVED);
  }

  async acknowledgeReview(user: Principal, id: string, dto: Dto<typeof acknowledgeReviewSchema>) {
    const r = await this.loadReview(user, id);
    if (r.employeeId !== user.userId) throw forbidden('Only the reviewed employee can acknowledge');
    if (r.status !== 'APPROVED') throw conflict('ILLEGAL_TRANSITION', `Cannot acknowledge a ${r.status} review`);
    return this.moveReview(user, r, 'ACKNOWLEDGED', { acknowledgedAt: new Date(), employeeComment: dto.comment }, 'review.acknowledged');
  }

  /** People who may be reviewed / coached by the caller (their scope), for pickers. */
  async teamMembers(user: Principal) {
    const ids = await scopeUserIds(this.access, user, 'coaching:view');
    const users = await this.prisma.user.findMany({
      where: { organizationId: user.organizationId, isActive: true, ...(ids ? { id: { in: ids } } : {}) },
      select: { id: true, name: true, managerId: true, roleAssignments: { select: { role: { select: { key: true } } } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 300,
    });
    return users.map((u) => ({ id: u.id, name: u.name, managerId: u.managerId, roles: u.roleAssignments.map((a) => a.role.key) }));
  }
}
