import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PLATFORM_EVENTS, WORKFORCE_EVENTS } from '@salesos/shared-types';
import type {
  createGoalSchema, createMilestoneSchema, goalCancelSchema, goalCommentSchema, goalProgressSchema, goalReturnSchema, goalSubmitSchema, goalVerifySchema,
  listGoalsQuerySchema, updateGoalSchema, updateMilestoneSchema,
} from '@salesos/validation';
import {
  computeGoalRisk, daysToTarget, elapsedSharePct, goalProgressPct, goalRiskApplies, goalTargetDate, localDay, transitionGoal,
  type GoalAction, type GoalActorRole, type GoalStatusKey,
} from '@salesos/workforce-core';
import type { z } from 'zod';
import ExcelJS from 'exceljs';
import { CONTENT_TYPES, neutralise } from '../../reporting/exports/writers';
import { AuditService, AUDIT_ACTIONS } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, forbidden, notFound } from '../../../common/http/errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService, type Tx } from '../../../common/prisma';
import { asPage, assertOrgUsers, isoDay, scopeUserIds, toDate, userNameMap } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
type GoalRow = Prisma.GoalGetPayload<{ include: { milestones: true } }>;

/** Domain events that have no constant in WORKFORCE_EVENTS (no notification attached). */
const EV = { UPDATED: 'goal.updated', PROGRESS: 'goal.progress_updated', COMMENTED: 'goal.commented', CANCELLED: 'goal.cancelled', MILESTONE: 'goal.milestone_changed' } as const;

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cfg: WorkforceConfigService,
  ) {}

  // ------------------------------------------------------------------ scope
  private async where(user: Principal): Promise<Prisma.GoalWhereInput> {
    const ids = await scopeUserIds(this.access, user, 'goals:view');
    if (ids === null) return { organizationId: user.organizationId };
    return { organizationId: user.organizationId, OR: [{ ownerId: { in: ids } }, { reviewerId: user.userId }] };
  }

  private async load(user: Principal, id: string): Promise<GoalRow> {
    const g = await this.prisma.goal.findFirst({ where: { AND: [await this.where(user), { id }] }, include: { milestones: true } });
    if (!g) throw notFound('Goal');
    return g;
  }

  /** The user holds goals:review and the goal owner is inside that scope (or the user is the named reviewer). Never the owner. */
  private async isReviewerSide(user: Principal, g: { ownerId: string; reviewerId: string | null }): Promise<boolean> {
    if (g.ownerId === user.userId || !this.access.has(user, 'goals:review')) return false;
    if (g.reviewerId === user.userId) return true;
    const level = this.access.scopeLevel(user, 'goals:review');
    if (level === 'org') return true;
    if (level === 'team') return (await this.access.visibleUsers(user)).ids.includes(g.ownerId);
    return false;
  }

  private async rolesFor(user: Principal, g: { ownerId: string; reviewerId: string | null; createdById: string }, action: GoalAction): Promise<Set<GoalActorRole>> {
    const roles = new Set<GoalActorRole>();
    const reviewer = await this.isReviewerSide(user, g);
    if (reviewer) roles.add('REVIEWER');
    if (action === 'CANCEL') {
      // the owner can cancel only a goal they created themselves; assigned goals are cancelled from the manager side
      if (reviewer || g.createdById === user.userId) roles.add('MANAGER_SIDE');
    } else if (g.ownerId === user.userId && this.access.has(user, 'goals:update')) {
      roles.add('OWNER');
    }
    return roles;
  }

  // ------------------------------------------------------------------ view
  private async capabilities(user: Principal, g: GoalRow, requireVerification: boolean) {
    const reviewer = await this.isReviewerSide(user, g);
    const isOwner = g.ownerId === user.userId && this.access.has(user, 'goals:update');
    const open = g.status === 'ACTIVE';
    const edit = open && (isOwner || reviewer || (g.createdById === user.userId && this.access.has(user, 'goals:update')));
    return {
      progress: isOwner && open,
      edit,
      milestones: edit,
      comment: g.status !== 'CANCELLED' && (isOwner || reviewer),
      submit: isOwner && open && requireVerification,
      completeDirect: isOwner && open && !requireVerification,
      verify: reviewer && g.status === 'PENDING_VERIFICATION',
      return: reviewer && g.status === 'PENDING_VERIFICATION',
      cancel: (g.status === 'ACTIVE' || g.status === 'PENDING_VERIFICATION') && (reviewer || g.createdById === user.userId),
    };
  }

  private async view(user: Principal, g: GoalRow, names: Map<string, string>, ctx: { today: string; gap: number; requireVerification: boolean }) {
    const start = isoDay(g.startDate)!;
    const target = isoDay(g.targetDate)!;
    const status = g.status as GoalStatusKey;
    const risk = computeGoalRisk({ status, progressPct: g.progressPct, startDay: start, targetDay: target, today: ctx.today, atRiskGapPct: ctx.gap });
    return {
      id: g.id, ownerId: g.ownerId, ownerName: names.get(g.ownerId) ?? null, reviewerId: g.reviewerId, reviewerName: g.reviewerId ? names.get(g.reviewerId) ?? null : null,
      createdById: g.createdById, createdByName: names.get(g.createdById) ?? null,
      title: g.title, description: g.description, startDate: start, targetDate: target, cycleDays: g.cycleDays,
      targetValue: g.targetValue?.toString() ?? null, currentValue: g.currentValue.toString(), unit: g.unit, progressPct: g.progressPct,
      status, risk, riskApplies: goalRiskApplies(status), elapsedPct: elapsedSharePct(start, target, ctx.today), daysToTarget: daysToTarget(target, ctx.today),
      submittedAt: g.submittedAt, verifiedAt: g.verifiedAt, verifiedByName: g.verifiedById ? names.get(g.verifiedById) ?? null : null, version: g.version, createdAt: g.createdAt, updatedAt: g.updatedAt,
      milestones: [...g.milestones].sort((a, b) => a.sortOrder - b.sortOrder).map((m) => ({ id: m.id, title: m.title, dueDate: isoDay(m.dueDate), done: m.done, doneAt: m.doneAt })),
      can: await this.capabilities(user, g, ctx.requireVerification),
    };
  }

  private async ctx(orgId: string) {
    const { config } = await this.cfg.getConfig(orgId);
    return { config, today: localDay(new Date(), config.timezone), gap: config.goals.atRiskGapPct, requireVerification: config.goals.requireVerification };
  }

  // ------------------------------------------------------------------ reads
  async list(user: Principal, q: Dto<typeof listGoalsQuerySchema>) {
    const scope = await this.where(user);
    const filters: Prisma.GoalWhereInput[] = [scope];
    if (q.view === 'mine') filters.push({ ownerId: user.userId });
    if (q.view === 'reviewing') filters.push({ reviewerId: user.userId });
    if (q.view === 'team') filters.push({ ownerId: { not: user.userId } });
    if (q.status) filters.push({ status: q.status });
    if (q.ownerId) filters.push({ ownerId: q.ownerId });
    const c = await this.ctx(user.organizationId);
    // risk is derived: filter by the stored value (kept fresh by every write and the daily job)
    if (q.risk) filters.push({ risk: q.risk });
    const rows = await this.prisma.goal.findMany({ where: { AND: filters }, include: { milestones: true }, orderBy: [{ targetDate: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((g) => [g.ownerId, g.reviewerId, g.createdById, g.verifiedById]));
    return asPage(res, await Promise.all(res.data.map((g) => this.view(user, g, names, c))));
  }

  async summary(user: Principal) {
    const where = await this.where(user);
    const [byStatus, byRisk, reviewing] = await Promise.all([
      this.prisma.goal.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.goal.groupBy({ by: ['risk'], where: { AND: [where, { status: { in: ['ACTIVE', 'PENDING_VERIFICATION', 'COMPLETED'] } }] }, _count: { _all: true } }),
      this.prisma.goal.count({ where: { AND: [where, { status: 'PENDING_VERIFICATION' }, { reviewerId: user.userId }] } }),
    ]);
    return {
      total: byStatus.reduce((n, r) => n + r._count._all, 0),
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      byRisk: Object.fromEntries(byRisk.map((r) => [r.risk, r._count._all])),
      awaitingMyVerification: reviewing,
    };
  }

  async get(user: Principal, id: string) {
    const g = await this.load(user, id);
    const c = await this.ctx(user.organizationId);
    const updates = await this.prisma.goalUpdate.findMany({ where: { goalId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500 });
    // linked tasks are shown only when the viewer may see work tasks, and only those inside their work-tasks:view scope
    let tasks: Array<Record<string, unknown>> = [];
    let tasksAvailable = false;
    if (this.access.has(user, 'work-tasks:view')) {
      tasksAvailable = true;
      const ids = await scopeUserIds(this.access, user, 'work-tasks:view');
      const rows = await this.prisma.workTask.findMany({
        where: { goalId: id, organizationId: user.organizationId, ...(ids ? { OR: [{ assigneeId: { in: ids } }, { assignerId: user.userId }] } : {}) },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: 100,
      });
      const tn = await userNameMap(this.prisma, user.organizationId, rows.flatMap((t) => [t.assigneeId, t.assignerId]));
      tasks = rows.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt, assigneeId: t.assigneeId, assigneeName: tn.get(t.assigneeId) ?? null }));
    }
    const names = await userNameMap(this.prisma, user.organizationId, [g.ownerId, g.reviewerId, g.createdById, g.verifiedById, ...updates.map((u) => u.authorId)]);
    return {
      ...(await this.view(user, g, names, c)),
      updates: updates.map((u) => ({ id: u.id, kind: u.kind, authorId: u.authorId, authorName: names.get(u.authorId) ?? null, currentValue: u.currentValue?.toString() ?? null, progressPct: u.progressPct, note: u.note, createdAt: u.createdAt })),
      tasks, tasksAvailable,
    };
  }

  /** Excel copy of one goal (visible to whoever can open the goal): details, progress history (one row per update) and linked tasks. */
  async exportXlsx(user: Principal, id: string) {
    const g = await this.get(user, id) as Awaited<ReturnType<GoalsService['get']>> & Record<string, unknown>;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'CoachEasily SalesOS';
    wb.created = new Date();
    const safe = (v: unknown) => (typeof v === 'string' ? neutralise(v) : v ?? '');
    const info = wb.addWorksheet('Goal');
    info.columns = [{ width: 28 }, { width: 70 }];
    const rows: Array<[string, unknown]> = [
      ['Goal', g.title], ['Details', g.description], ['Owner', g.ownerName], ['Reviewer', g.reviewerName], ['Start date', g.startDate], ['Target date', g.targetDate], ['Cycle (days)', g.cycleDays],
      ['Status', g.status], ['Risk', g.risk], ['Progress %', g.progressPct], ['Measurable target', g.targetValue], ['Current value', g.currentValue], ['Unit', g.unit],
      ['Verified by', g.verifiedByName], ['Verified at', g.verifiedAt], ['Exported at (UTC)', new Date().toISOString()],
    ];
    for (const [k, v] of rows) info.addRow([k, safe(v instanceof Date ? v.toISOString() : v)]);
    info.getColumn(1).font = { bold: true };
    const hist = wb.addWorksheet('Progress history', { views: [{ state: 'frozen', ySplit: 1 }] });
    hist.columns = [{ header: 'When (UTC)', width: 24 }, { header: 'What', width: 14 }, { header: 'By', width: 24 }, { header: 'Progress %', width: 12 }, { header: 'Current value', width: 14 }, { header: 'Note', width: 60 }];
    hist.getRow(1).font = { bold: true };
    for (const u of g.updates) hist.addRow([u.createdAt.toISOString(), u.kind, safe(u.authorName), u.progressPct, u.currentValue === null ? null : Number(u.currentValue), safe(u.note)]);
    const tasks = wb.addWorksheet('Linked tasks', { views: [{ state: 'frozen', ySplit: 1 }] });
    tasks.columns = [{ header: 'Task', width: 44 }, { header: 'Assignee', width: 24 }, { header: 'Status', width: 14 }, { header: 'Priority', width: 12 }, { header: 'Due', width: 24 }];
    tasks.getRow(1).font = { bold: true };
    for (const tk of g.tasks as Array<{ title: string; assigneeName: string | null; status: string; priority: string; dueAt: Date | null }>) tasks.addRow([safe(tk.title), safe(tk.assigneeName), tk.status, tk.priority, tk.dueAt ? tk.dueAt.toISOString() : null]);
    const data = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: AUDIT_ACTIONS.EXPORT_CREATED, entityType: 'workforce_goal_export', entityId: id, metadata: { format: 'xlsx', updates: g.updates.length, tasks: (g.tasks as unknown[]).length } });
    const slug = String(g.title).replace(/[^\w.-]+/g, '_').slice(0, 40) || 'goal';
    return { data, contentType: CONTENT_TYPES.XLSX, fileName: `goal_${slug}_${String(g.startDate).slice(0, 10)}.xlsx` };
  }

  // ------------------------------------------------------------------ writes
  /** Default reviewer: the owner's manager, else an active Team Lead, else an active Founder; never the owner. */
  private async defaultReviewer(orgId: string, ownerId: string): Promise<string | null> {
    const owner = await this.prisma.user.findFirst({ where: { id: ownerId, organizationId: orgId }, select: { managerId: true } });
    if (owner?.managerId && owner.managerId !== ownerId) {
      const m = await this.prisma.user.findFirst({ where: { id: owner.managerId, organizationId: orgId, isActive: true }, select: { id: true } });
      if (m) return m.id;
    }
    for (const role of ['SALES_TEAM_LEAD', 'FOUNDER_CEO']) {
      const u = await this.prisma.user.findFirst({ where: { organizationId: orgId, isActive: true, id: { not: ownerId }, roleAssignments: { some: { role: { key: role } } } }, select: { id: true }, orderBy: { createdAt: 'asc' } });
      if (u) return u.id;
    }
    return null;
  }

  private async event(tx: Tx, user: Principal, g: { id: string; ownerId: string; version: number }, eventType: string, extra: Record<string, unknown> = {}) {
    await this.outbox.publish(tx, {
      eventType, aggregateType: 'goal', aggregateId: g.id, organizationId: user.organizationId,
      payload: { goalId: g.id, organizationId: user.organizationId, ownerId: g.ownerId, actorId: user.userId, ...extra },
      idempotencyKey: `${eventType}:${g.id}:${g.version}:${(extra.updateId as string | undefined) ?? (extra.milestoneId as string | undefined) ?? user.userId}`,
    });
  }

  private async notify(tx: Tx, user: Principal, goalId: string, userIds: Array<string | null | undefined>, title: string, key: string) {
    const ids = [...new Set(userIds.filter((i): i is string => !!i && i !== user.userId))];
    if (ids.length === 0) return;
    await this.outbox.publish(tx, {
      eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'goal', aggregateId: goalId, organizationId: user.organizationId,
      payload: { organizationId: user.organizationId, type: 'goal.update', userIds: ids, entity: { type: 'goal', id: goalId }, dedupeKey: key, actionUrl: `/work/goals/${goalId}`, title },
      idempotencyKey: `notification.requested:${key}`,
    });
  }

  private async auditTx(tx: Tx, user: Principal, action: string, g: { id: string; ownerId: string }, metadata: Record<string, unknown> = {}) {
    await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action, entityType: 'goal', entityId: g.id, metadata: { ownerId: g.ownerId, ...metadata } });
  }

  /** compare-and-set on version (optional client version); throws 409 when the goal changed under us */
  private async cas(tx: Tx, g: GoalRow, clientVersion: number | undefined, data: Prisma.GoalUncheckedUpdateManyInput) {
    if (clientVersion !== undefined && clientVersion !== g.version) throw conflict('STALE_VERSION', 'The goal changed; reload and retry');
    const res = await tx.goal.updateMany({ where: { id: g.id, version: g.version }, data: { ...data, version: { increment: 1 } } });
    if (res.count !== 1) throw conflict('STALE_VERSION', 'The goal changed; reload and retry');
  }

  async create(user: Principal, dto: Dto<typeof createGoalSchema>) {
    const ownerId = dto.ownerId ?? user.userId;
    if (ownerId !== user.userId) {
      const level = this.access.scopeLevel(user, 'goals:create');
      if (level === 'own' || !level) throw forbidden('You can only create goals for yourself');
      await assertOrgUsers(this.prisma, user.organizationId, [ownerId]);
      if (level === 'team' && !(await this.access.visibleUsers(user)).ids.includes(ownerId)) throw notFound('Employee');
    }
    const c = await this.ctx(user.organizationId);
    const start = dto.startDate ?? c.today;
    const cycleDays = dto.cycleDays ?? c.config.goals.cycleDays;
    const target = dto.targetDate ?? goalTargetDate(start, cycleDays);
    if (target < start) throw new AppError('VALIDATION_ERROR', 'The target date cannot be before the start date', 400);
    let reviewerId: string | null;
    if (dto.reviewerId !== undefined) {
      reviewerId = dto.reviewerId;
      if (reviewerId) {
        if (reviewerId === ownerId) throw new AppError('INVALID_REVIEWER', 'The reviewer cannot be the goal owner', 422);
        await assertOrgUsers(this.prisma, user.organizationId, [reviewerId]);
      }
    } else reviewerId = await this.defaultReviewer(user.organizationId, ownerId);
    const id = await this.prisma.$transaction(async (tx) => {
      const g = await tx.goal.create({
        data: {
          organizationId: user.organizationId, ownerId, reviewerId, createdById: user.userId, title: dto.title, description: dto.description ?? null,
          startDate: toDate(start), targetDate: toDate(target), cycleDays: Math.max(1, Math.round((toDate(target).getTime() - toDate(start).getTime()) / 86_400_000) + 1),
          targetValue: dto.targetValue ?? null, unit: dto.unit ?? null, progressPct: 0,
          risk: computeGoalRisk({ status: 'ACTIVE', progressPct: 0, startDay: start, targetDay: target, today: c.today, atRiskGapPct: c.gap }),
          milestones: { create: dto.milestones.map((m, i) => ({ organizationId: user.organizationId, title: m.title, dueDate: m.dueDate ? toDate(m.dueDate) : null, sortOrder: i })) },
        },
      });
      await this.auditTx(tx, user, 'goal.created', g, { reviewerId, assigned: ownerId !== user.userId });
      await this.event(tx, user, g, WORKFORCE_EVENTS.GOAL_CREATED, { reviewerId });
      if (ownerId !== user.userId) await this.notify(tx, user, g.id, [ownerId], 'A goal was set for you', `goal.created:${g.id}`);
      return g.id;
    });
    return this.get(user, id);
  }

  async update(user: Principal, id: string, dto: Dto<typeof updateGoalSchema>) {
    const g = await this.load(user, id);
    const caps = await this.capabilities(user, g, true);
    if (!caps.edit) throw forbidden('You cannot edit this goal');
    const c = await this.ctx(user.organizationId);
    const data: Prisma.GoalUncheckedUpdateManyInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.unit !== undefined) data.unit = dto.unit;
    let target = isoDay(g.targetDate)!;
    if (dto.targetDate !== undefined) {
      if (dto.targetDate < isoDay(g.startDate)!) throw new AppError('VALIDATION_ERROR', 'The target date cannot be before the start date', 400);
      target = dto.targetDate;
      data.targetDate = toDate(target);
    }
    let progress = g.progressPct;
    if (dto.targetValue !== undefined) {
      data.targetValue = dto.targetValue;
      progress = goalProgressPct({ currentValue: g.currentValue.toString(), targetValue: dto.targetValue, manualPct: g.progressPct });
      data.progressPct = progress;
    }
    if (dto.reviewerId !== undefined) {
      if (dto.reviewerId) {
        if (dto.reviewerId === g.ownerId) throw new AppError('INVALID_REVIEWER', 'The reviewer cannot be the goal owner', 422);
        await assertOrgUsers(this.prisma, user.organizationId, [dto.reviewerId]);
      }
      data.reviewerId = dto.reviewerId;
    }
    data.risk = computeGoalRisk({ status: 'ACTIVE', progressPct: progress, startDay: isoDay(g.startDate)!, targetDay: target, today: c.today, atRiskGapPct: c.gap });
    await this.prisma.$transaction(async (tx) => {
      await this.cas(tx, g, dto.version, data);
      await this.auditTx(tx, user, 'goal.updated', g, { fields: Object.keys(dto).filter((k) => k !== 'version') });
      await this.event(tx, user, { ...g, version: g.version + 1 }, EV.UPDATED);
    });
    return this.get(user, id);
  }

  async progress(user: Principal, id: string, dto: Dto<typeof goalProgressSchema>) {
    const g = await this.load(user, id);
    if (g.ownerId !== user.userId) throw forbidden('Only the goal owner can post progress');
    if (g.status !== 'ACTIVE') throw conflict('GOAL_LOCKED', 'Progress can be posted only on an active goal');
    const measurable = g.targetValue != null && Number(g.targetValue) > 0;
    if (measurable && dto.currentValue === undefined) throw new AppError('VALIDATION_ERROR', 'This goal has a measurable target: provide currentValue', 400);
    if (!measurable && dto.progressPct === undefined) throw new AppError('VALIDATION_ERROR', 'This goal has no measurable target: provide progressPct', 400);
    const c = await this.ctx(user.organizationId);
    const currentValue = measurable ? dto.currentValue! : g.currentValue.toString();
    const pct = goalProgressPct({ currentValue, targetValue: g.targetValue?.toString() ?? null, manualPct: dto.progressPct ?? g.progressPct });
    const risk = computeGoalRisk({ status: 'ACTIVE', progressPct: pct, startDay: isoDay(g.startDate)!, targetDay: isoDay(g.targetDate)!, today: c.today, atRiskGapPct: c.gap });
    await this.prisma.$transaction(async (tx) => {
      await this.cas(tx, g, dto.version, { currentValue, progressPct: pct, risk });
      await tx.goalUpdate.create({ data: { organizationId: user.organizationId, goalId: id, authorId: user.userId, kind: 'PROGRESS', currentValue, progressPct: pct, note: dto.note ?? null } });
      await this.auditTx(tx, user, 'goal.progress_updated', g, { progressPct: pct, risk });
      await this.event(tx, user, { ...g, version: g.version + 1 }, EV.PROGRESS, { progressPct: pct, risk });
    });
    return this.get(user, id);
  }

  async addMilestone(user: Principal, id: string, dto: Dto<typeof createMilestoneSchema>) {
    const g = await this.load(user, id);
    if (!(await this.capabilities(user, g, true)).milestones) throw forbidden('You cannot change milestones of this goal');
    await this.prisma.$transaction(async (tx) => {
      const last = await tx.goalMilestone.aggregate({ where: { goalId: id }, _max: { sortOrder: true } });
      if (g.milestones.length >= 30) throw new AppError('LIMIT', 'A goal can have at most 30 milestones', 422);
      const m = await tx.goalMilestone.create({ data: { organizationId: user.organizationId, goalId: id, title: dto.title, dueDate: dto.dueDate ? toDate(dto.dueDate) : null, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
      await this.auditTx(tx, user, 'goal.milestone_added', g, { milestoneId: m.id });
      await this.event(tx, user, g, EV.MILESTONE, { milestoneId: m.id, change: 'added' });
    });
    return this.get(user, id);
  }

  async updateMilestone(user: Principal, id: string, mid: string, dto: Dto<typeof updateMilestoneSchema>) {
    const g = await this.load(user, id);
    if (!(await this.capabilities(user, g, true)).milestones) throw forbidden('You cannot change milestones of this goal');
    const m = g.milestones.find((x) => x.id === mid);
    if (!m) throw notFound('Milestone');
    await this.prisma.$transaction(async (tx) => {
      await tx.goalMilestone.update({
        where: { id: mid },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? toDate(dto.dueDate) : null } : {}),
          ...(dto.done !== undefined ? { done: dto.done, doneAt: dto.done ? new Date() : null } : {}),
        },
      });
      await this.auditTx(tx, user, 'goal.milestone_updated', g, { milestoneId: mid, fields: Object.keys(dto) });
      await this.event(tx, user, g, EV.MILESTONE, { milestoneId: mid, change: 'updated' });
    });
    return this.get(user, id);
  }

  async comment(user: Principal, id: string, dto: Dto<typeof goalCommentSchema>) {
    const g = await this.load(user, id);
    if (!(await this.capabilities(user, g, true)).comment) throw forbidden('You cannot comment on this goal');
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.goalUpdate.create({ data: { organizationId: user.organizationId, goalId: id, authorId: user.userId, kind: 'COMMENT', note: dto.note } });
      await this.auditTx(tx, user, 'goal.commented', g, {});
      await this.event(tx, user, { ...g, version: g.version }, EV.COMMENTED, { updateId: u.id });
      await this.notify(tx, user, id, [user.userId === g.ownerId ? g.reviewerId : g.ownerId], 'New comment on a goal', `goal.comment:${u.id}`);
    });
    return this.get(user, id);
  }

  private async transition(user: Principal, id: string, action: GoalAction, dto: { version?: number; note?: string }, audit: string, eventType: string, notifyTitle: string | null) {
    const g = await this.load(user, id);
    const c = await this.ctx(user.organizationId);
    const roles = await this.rolesFor(user, g, action);
    const r = transitionGoal(g.status as GoalStatusKey, action, roles, { requireVerification: c.requireVerification });
    if (!r.ok) {
      if (r.code === 'NOT_ALLOWED') throw forbidden('You cannot perform this action on the goal');
      if (r.code === 'VERIFICATION_DISABLED') throw new AppError('ILLEGAL_TRANSITION', 'This action is not available under the current goal policy', 409);
      throw new AppError('ILLEGAL_TRANSITION', `Cannot ${action.toLowerCase()} a goal that is ${g.status}`, 409);
    }
    if (r.needsNote && !dto.note) throw new AppError('VALIDATION_ERROR', 'A note is required', 400);
    if (action === 'SUBMIT' && !g.reviewerId) throw new AppError('NO_REVIEWER', 'This goal has no reviewer; ask your manager to set one before submitting', 422);
    const now = new Date();
    const risk = computeGoalRisk({ status: r.to, progressPct: g.progressPct, startDay: isoDay(g.startDate)!, targetDay: isoDay(g.targetDate)!, today: c.today, atRiskGapPct: c.gap });
    const data: Prisma.GoalUncheckedUpdateManyInput = { status: r.to, risk };
    if (action === 'SUBMIT') data.submittedAt = now;
    if (action === 'COMPLETE_DIRECT') { data.submittedAt = now; data.verifiedAt = null; }
    if (action === 'VERIFY') { data.verifiedAt = now; data.verifiedById = user.userId; }
    if (action === 'RETURN') { data.submittedAt = null; }
    await this.prisma.$transaction(async (tx) => {
      await this.cas(tx, g, dto.version, data);
      const kind = action === 'SUBMIT' || action === 'COMPLETE_DIRECT' ? 'SUBMITTED' : action === 'VERIFY' ? 'VERIFIED' : action === 'RETURN' ? 'RETURNED' : 'COMMENT';
      await tx.goalUpdate.create({
        data: { organizationId: user.organizationId, goalId: id, authorId: user.userId, kind, currentValue: g.currentValue, progressPct: g.progressPct, note: action === 'CANCEL' ? `Cancelled: ${dto.note ?? ''}` : dto.note ?? null },
      });
      // goal narrative (notes) stays out of the audit log; status only
      await this.auditTx(tx, user, audit, g, { from: g.status, to: r.to });
      await this.event(tx, user, { ...g, version: g.version + 1 }, eventType, { from: g.status, to: r.to });
      if (notifyTitle) {
        const recipients = action === 'SUBMIT' ? [g.reviewerId] : action === 'CANCEL' ? [g.ownerId, g.reviewerId] : [g.ownerId];
        await this.notify(tx, user, id, recipients, notifyTitle, `goal.${action.toLowerCase()}:${id}:${g.version + 1}`);
      }
    });
    return this.get(user, id);
  }

  submit(user: Principal, id: string, dto: Dto<typeof goalSubmitSchema>) {
    return this.ctx(user.organizationId).then((c) => this.transition(user, id, c.requireVerification ? 'SUBMIT' : 'COMPLETE_DIRECT', dto, c.requireVerification ? 'goal.submitted' : 'goal.completed', WORKFORCE_EVENTS.GOAL_SUBMITTED, c.requireVerification ? 'A goal was submitted for verification' : null));
  }
  verify(user: Principal, id: string, dto: Dto<typeof goalVerifySchema>) {
    return this.transition(user, id, 'VERIFY', dto, 'goal.verified', WORKFORCE_EVENTS.GOAL_VERIFIED, 'Your goal was verified');
  }
  returnGoal(user: Principal, id: string, dto: Dto<typeof goalReturnSchema>) {
    return this.transition(user, id, 'RETURN', dto, 'goal.returned', WORKFORCE_EVENTS.GOAL_RETURNED, 'Your goal was returned for more work');
  }
  cancel(user: Principal, id: string, dto: Dto<typeof goalCancelSchema>) {
    return this.transition(user, id, 'CANCEL', { version: dto.version, note: dto.reason }, 'goal.cancelled', EV.CANCELLED, 'A goal was cancelled');
  }
}

