import { Injectable } from '@nestjs/common';
import { Prisma, type Target, type TargetPeriod } from '@prisma/client';
import { REVENUE_EVENTS } from '@salesos/shared-types';
import type { z } from 'zod';
import type { asOfQuerySchema, createPeriodSchema, createTargetSchema, decideRevisionSchema, listPeriodsQuerySchema, listTargetsQuerySchema, reviseTargetSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { D, LEVEL_ROLE, achievementPct, childLevel, dailySeries, istDate, istRange, money, pacing, periodBounds, prorate, prorationBasis, revisionApproverRoles, round2, sum, targetAsOf, type TargetLevel, ZERO } from '../calc';
import { MetricsService } from '../metrics.service';
import { RevenueSupport, dateOnly, hasRole, isUniqueViolation, iso, isoDay, primaryRole, recordAccess } from '../revenue.support';

type TargetWithPeriod = Target & { period: TargetPeriod };
const todayIst = () => istDate(new Date());

@Injectable()
export class TargetsService {
  constructor(
    private readonly s: RevenueSupport,
    private readonly metrics: MetricsService,
  ) {}

  private get prisma() {
    return this.s.prisma;
  }

  private serializePeriod(p: TargetPeriod) {
    return { id: p.id, type: p.type, label: p.label, startsOn: isoDay(p.startsOn)!, endsOn: isoDay(p.endsOn)!, createdAt: iso(p.createdAt) };
  }

  private serialize(t: TargetWithPeriod, names: Map<string, string>, summaryOnly: boolean, pending?: { id: string; newAmount: string; proposedAt: string } | null) {
    return {
      id: t.id,
      periodId: t.periodId,
      period: this.serializePeriod(t.period),
      metric: t.metric,
      level: t.level,
      unit: t.metric === 'ENROLMENT' ? 'COUNT' : t.currency,
      ownerUserId: summaryOnly ? null : t.ownerUserId,
      ownerName: summaryOnly ? null : names.get(t.ownerUserId) ?? null,
      teamId: summaryOnly ? null : t.teamId,
      parentId: t.parentId,
      amount: t.metric === 'ENROLMENT' ? D(t.amount).toFixed(0) : money(t.amount),
      originalAmount: t.metric === 'ENROLMENT' ? D(t.originalAmount).toFixed(0) : money(t.originalAmount),
      currency: t.currency,
      prorationBasis: t.prorationBasis ?? null,
      note: summaryOnly ? null : t.note,
      version: t.version,
      pendingRevision: pending ?? null,
      createdAt: iso(t.createdAt),
    };
  }

  private async loadTarget(user: Principal, id: string, permission: 'targets:view' | 'targets:update' | 'targets:approve' | 'targets:create' = 'targets:view'): Promise<TargetWithPeriod> {
    const t = await this.prisma.target.findFirst({ where: { id, organizationId: user.organizationId }, include: { period: true } });
    await this.s.access.assertRecordAccess(user, permission, t && recordAccess({ organizationId: t.organizationId, ownerId: t.ownerUserId, teamId: t.teamId }), 'Target');
    return t!;
  }

  // ---- periods ---------------------------------------------------------------------------------------------------
  async listPeriods(user: Principal, q: z.infer<typeof listPeriodsQuerySchema>) {
    const where: Prisma.TargetPeriodWhereInput = { organizationId: user.organizationId };
    if (q.type) where.type = q.type;
    if (q.year) where.startsOn = { gte: new Date(Date.UTC(q.year, 0, 1)), lt: new Date(Date.UTC(q.year + 1, 0, 1)) };
    const rows = await this.prisma.targetPeriod.findMany({ where, orderBy: [{ startsOn: 'desc' }, { id: 'desc' }], take: 200 });
    return rows.map((p) => this.serializePeriod(p));
  }

  async createPeriod(user: Principal, b: z.infer<typeof createPeriodSchema>) {
    const settings = await this.s.settings(this.prisma, user.organizationId);
    const bounds = periodBounds(b.type, b.anchor, settings.fiscalYearStartMonth);
    const found = await this.prisma.targetPeriod.findUnique({ where: { organizationId_type_startsOn: { organizationId: user.organizationId, type: b.type, startsOn: dateOnly(bounds.startsOn) } } });
    if (found) return this.serializePeriod(found);
    try {
      const p = await this.s.tx(async (tx) => {
        const created = await tx.targetPeriod.create({ data: { organizationId: user.organizationId, type: b.type, label: bounds.label, startsOn: dateOnly(bounds.startsOn), endsOn: dateOnly(bounds.endsOn), createdById: user.userId } });
        await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'target_period.created', entityType: 'target_period', entityId: created.id, metadata: { type: b.type, startsOn: bounds.startsOn, endsOn: bounds.endsOn } });
        return created;
      });
      return this.serializePeriod(p);
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await this.prisma.targetPeriod.findFirstOrThrow({ where: { organizationId: user.organizationId, type: b.type, startsOn: dateOnly(bounds.startsOn) } });
        return this.serializePeriod(again);
      }
      throw e;
    }
  }

  // ---- list / get ------------------------------------------------------------------------------------------------
  async list(user: Principal, q: z.infer<typeof listTargetsQuerySchema>) {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'targets:view', ownerField: 'ownerUserId', teamField: 'teamId' });
    const where: Prisma.TargetWhereInput = { ...scoped };
    if (q.periodId) where.periodId = q.periodId;
    if (q.metric) where.metric = q.metric;
    if (q.level) where.level = q.level;
    if (q.ownerUserId) where.ownerUserId = q.ownerUserId;
    if (q.parentId) where.parentId = q.parentId;
    const rows = await this.prisma.target.findMany({ where, include: { period: true }, orderBy: [{ period: { startsOn: 'desc' } }, { level: 'asc' }, { id: 'desc' }], ...pageArgs(q) });
    const total = q.page ? await this.prisma.target.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    const page = res.data as TargetWithPeriod[];
    const summaryOnly = this.s.access.isSummaryOnly(user, 'targets:view');
    const names = await this.s.userNames(page.map((t) => t.ownerUserId));
    const pend = await this.prisma.targetRevision.findMany({ where: { targetId: { in: page.map((t) => t.id) }, status: 'PENDING' } });
    const pendBy = new Map(pend.map((p) => [p.targetId, { id: p.id, newAmount: money(p.newAmount), proposedAt: p.proposedAt.toISOString() }]));
    return ok(page.map((t) => this.serialize(t, names, summaryOnly, pendBy.get(t.id))), res.meta);
  }

  async get(user: Principal, id: string) {
    const t = await this.loadTarget(user, id);
    const summaryOnly = this.s.access.isSummaryOnly(user, 'targets:view');
    const names = await this.s.userNames([t.ownerUserId]);
    const pend = await this.prisma.targetRevision.findFirst({ where: { targetId: id, status: 'PENDING' } });
    return this.serialize(t, names, summaryOnly, pend && { id: pend.id, newAmount: money(pend.newAmount), proposedAt: pend.proposedAt.toISOString() });
  }

  // ---- create ----------------------------------------------------------------------------------------------------
  async create(user: Principal, b: z.infer<typeof createTargetSchema>) {
    const period = await this.prisma.targetPeriod.findFirst({ where: { id: b.periodId, organizationId: user.organizationId } });
    if (!period) throw notFound('Target period');
    const owner = await this.s.assertUserInScope(user, 'targets:create', b.ownerUserId);
    if (!owner.roles.includes(LEVEL_ROLE[b.level])) throw new AppError('OWNER_ROLE_MISMATCH', `A ${b.level} target must be owned by a user with the ${LEVEL_ROLE[b.level]} role`, 422);
    if (b.metric === 'ENROLMENT' && !D(b.amount).isInteger()) throw new AppError('VALIDATION_ERROR', 'Enrolment targets must be whole numbers', 422);

    let parent: Target | null = null;
    if (b.parentId) {
      parent = await this.prisma.target.findFirst({ where: { id: b.parentId, organizationId: user.organizationId } });
      await this.s.access.assertRecordAccess(user, 'targets:create', parent && recordAccess({ organizationId: parent.organizationId, ownerId: parent.ownerUserId, teamId: parent.teamId }), 'Parent target');
      if (parent!.periodId !== b.periodId || parent!.metric !== b.metric) throw new AppError('PARENT_MISMATCH', 'The parent target must be for the same period and metric', 422);
      if (childLevel(parent!.level) !== b.level) throw new AppError('LEVEL_MISMATCH', `A ${parent!.level} target breaks down into ${childLevel(parent!.level) ?? 'nothing'}, not ${b.level}`, 422);
      if (parent!.level !== 'FOUNDER') {
        const under = await this.s.subtreeUserIds(user.organizationId, parent!.ownerUserId);
        if (!under.includes(owner.id)) throw new AppError('OWNER_NOT_UNDER_PARENT', 'The owner does not report to the parent target owner', 422);
      }
    } else {
      if (b.level !== 'FOUNDER' && b.level !== 'TEAM_LEAD') throw new AppError('PARENT_REQUIRED', 'Manager and executive targets must break down a parent target', 422);
      if (this.s.access.scopeLevel(user, 'targets:create') !== 'org') throw new AppError('FORBIDDEN', 'Only organisation-level target owners can create top-level targets', 403);
    }

    let amount = D(b.amount);
    let basis: Prisma.InputJsonValue | undefined;
    if (b.proration) {
      const pb = prorationBasis(isoDay(period.startsOn)!, isoDay(period.endsOn)!, b.proration.joinOn, b.proration.leaveOn);
      amount = b.metric === 'ENROLMENT' ? prorate(amount, pb).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP) : prorate(amount, pb);
      basis = { ...pb, baseAmount: money(b.amount), factor: `${pb.workingDaysActive}/${pb.workingDaysPeriod}`, method: 'WORKING_DAYS_MON_SAT' };
    }
    const teamId = await this.s.teamOf(this.prisma, owner.id);
    try {
      const created = await this.s.tx(async (tx) => {
        if (parent) {
          const locked = await this.s.lockTarget(tx, user.organizationId, parent.id);
          const siblings = await tx.target.findMany({ where: { parentId: parent.id }, select: { amount: true } });
          const allocated = sum(siblings.map((x) => x.amount));
          if (allocated.plus(amount).greaterThan(locked.amount)) {
            throw new AppError('BREAKDOWN_EXCEEDS_PARENT', 'The breakdown would exceed the parent target', 422, { parentAmount: money(locked.amount), allocated: money(allocated), requested: money(amount), remaining: money(locked.amount.minus(allocated)) });
          }
        }
        const t = await tx.target.create({
          data: { organizationId: user.organizationId, periodId: b.periodId, metric: b.metric, level: b.level, ownerUserId: owner.id, teamId, parentId: parent?.id ?? null, amount: round2(amount), originalAmount: round2(amount), currency: 'INR', prorationBasis: basis, note: b.note ?? null, createdById: user.userId },
          include: { period: true },
        });
        await tx.targetRevision.create({ data: { organizationId: user.organizationId, targetId: t.id, seq: 0, oldAmount: null, newAmount: t.amount, reason: 'Initial target', status: 'APPROVED', effectiveFrom: period.startsOn, proposedById: user.userId, decidedById: user.userId, decidedAt: new Date() } });
        await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'target.created', entityType: 'target', entityId: t.id, metadata: { metric: t.metric, level: t.level, ownerUserId: t.ownerUserId, amount: money(t.amount), parentId: t.parentId, prorated: !!basis } });
        return t;
      });
      const names = await this.s.userNames([created.ownerUserId]);
      return this.serialize(created, names, false);
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('TARGET_EXISTS', 'This owner already has a target for the period and metric; revise it instead', 409);
      throw e;
    }
  }

  // ---- revisions (DEC-002) ---------------------------------------------------------------------------------------
  async revise(user: Principal, id: string, b: z.infer<typeof reviseTargetSchema>) {
    const t = await this.loadTarget(user, id, 'targets:update');
    const newAmount = D(b.newAmount);
    if (t.metric === 'ENROLMENT' && !newAmount.isInteger()) throw new AppError('VALIDATION_ERROR', 'Enrolment targets must be whole numbers', 422);
    const effective = b.effectiveFrom ?? (todayIst() > isoDay(t.period.endsOn)! ? isoDay(t.period.endsOn)! : todayIst() < isoDay(t.period.startsOn)! ? isoDay(t.period.startsOn)! : todayIst());
    if (newAmount.equals(t.amount)) throw new AppError('NO_CHANGE', 'The proposed value equals the current target', 422);
    await this.assertWithinTree(t, newAmount);
    try {
      const rev = await this.s.tx(async (tx) => {
        const locked = await this.s.lockTarget(tx, user.organizationId, t.id);
        if (await tx.targetRevision.findFirst({ where: { targetId: t.id, status: 'PENDING' } })) throw new AppError('REVISION_PENDING', 'A revision is already waiting for approval', 409);
        const last = await tx.targetRevision.aggregate({ where: { targetId: t.id }, _max: { seq: true } });
        const r = await tx.targetRevision.create({ data: { organizationId: user.organizationId, targetId: t.id, seq: (last._max.seq ?? 0) + 1, oldAmount: locked.amount, newAmount: round2(newAmount), reason: b.reason, status: 'PENDING', effectiveFrom: dateOnly(effective), proposedById: user.userId } });
        await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'target.revision_proposed', entityType: 'target', entityId: t.id, metadata: { revisionId: r.id, old: money(locked.amount), new: money(newAmount), reason: b.reason, effectiveFrom: effective } });
        await this.s.publish(tx, { eventType: REVENUE_EVENTS.TARGET_REVISION_PROPOSED, aggregateType: 'target', aggregateId: t.id, organizationId: user.organizationId, payload: { targetId: t.id, revisionId: r.id, proposedById: user.userId }, idempotencyKey: `target.revision_proposed:${r.id}` });
        const approvers = revisionApproverRoles(t.level as TargetLevel);
        await this.s.notify(tx, { organizationId: user.organizationId, type: 'founder.action_item', roles: [...approvers], dedupeKey: `target.revision:${r.id}`, title: 'Target revision awaiting approval', body: `A ${t.metric.toLowerCase()} target revision for ${t.period.label} needs a decision.`, entity: { type: 'target', id: t.id }, actionUrl: '/revenue/targets' });
        return r;
      });
      return this.revisionDto(rev, new Map());
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('REVISION_PENDING', 'A revision is already waiting for approval', 409);
      throw e;
    }
  }

  /** Children must still fit under the new value; the new value must still fit under the parent next to its siblings. */
  private async assertWithinTree(t: Target, newAmount: Prisma.Decimal, db: Pick<typeof this.prisma, 'target'> = this.prisma) {
    const kids = await db.target.findMany({ where: { parentId: t.id }, select: { amount: true } });
    const childSum = sum(kids.map((k) => k.amount));
    if (childSum.greaterThan(newAmount)) throw new AppError('BREAKDOWN_EXCEEDS_PARENT', 'The new value is below the amount already allocated to the breakdown below it', 422, { allocatedBelow: money(childSum), requested: money(newAmount) });
    if (t.parentId) {
      const parent = await db.target.findUniqueOrThrow({ where: { id: t.parentId } });
      const sibs = await db.target.findMany({ where: { parentId: t.parentId, id: { not: t.id } }, select: { amount: true } });
      const others = sum(sibs.map((k) => k.amount));
      if (others.plus(newAmount).greaterThan(parent.amount)) throw new AppError('BREAKDOWN_EXCEEDS_PARENT', 'The new value does not fit under the parent target next to its siblings', 422, { parentAmount: money(parent.amount), siblings: money(others), requested: money(newAmount) });
    }
  }

  private revisionDto(r: Prisma.TargetRevisionGetPayload<object>, names: Map<string, string>) {
    return {
      id: r.id,
      targetId: r.targetId,
      seq: r.seq,
      oldAmount: r.oldAmount === null ? null : money(r.oldAmount),
      newAmount: money(r.newAmount),
      reason: r.reason,
      status: r.status,
      effectiveFrom: isoDay(r.effectiveFrom)!,
      proposedById: r.proposedById,
      proposedByName: names.get(r.proposedById) ?? null,
      proposedAt: iso(r.proposedAt),
      decidedById: r.decidedById,
      decidedByName: r.decidedById ? names.get(r.decidedById) ?? null : null,
      decidedAt: iso(r.decidedAt),
      decisionNote: r.decisionNote,
    };
  }

  async revisions(user: Principal, id: string) {
    await this.loadTarget(user, id);
    const rows = await this.prisma.targetRevision.findMany({ where: { targetId: id }, orderBy: { seq: 'desc' } });
    const names = await this.s.userNames(rows.flatMap((r) => [r.proposedById, r.decidedById]));
    return rows.map((r) => this.revisionDto(r, names));
  }

  async decide(user: Principal, id: string, b: z.infer<typeof decideRevisionSchema>) {
    const t = await this.loadTarget(user, id, 'targets:approve');
    const allowed = revisionApproverRoles(t.level as TargetLevel);
    if (!hasRole(user, ...allowed)) throw new AppError('FORBIDDEN', `A ${t.level} target revision must be approved by ${allowed.join(' or ')}`, 403);
    const rev = await this.prisma.targetRevision.findFirst({ where: { id: b.revisionId, targetId: id, organizationId: user.organizationId } });
    if (!rev) throw notFound('Revision');
    if (rev.status !== 'PENDING') throw new AppError('INVALID_TRANSITION', 'This revision has already been decided', 409);
    if (rev.proposedById === user.userId && !hasRole(user, 'FOUNDER_CEO')) throw new AppError('SEPARATION_OF_DUTIES', 'You cannot approve your own revision', 403);
    const approve = b.decision === 'approve';
    await this.s.tx(async (tx) => {
      const locked = await this.s.lockTarget(tx, user.organizationId, id);
      const cas = await tx.targetRevision.updateMany({ where: { id: rev.id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: user.userId, decidedAt: new Date(), decisionNote: b.note ?? null } });
      if (cas.count !== 1) throw new AppError('INVALID_TRANSITION', 'This revision has already been decided', 409);
      if (approve) {
        await this.assertWithinTree(locked, rev.newAmount, tx);
        await tx.target.update({ where: { id }, data: { amount: rev.newAmount, version: { increment: 1 } } });
      }
      await this.s.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: approve ? 'target.revision_approved' : 'target.revision_rejected', entityType: 'target', entityId: id, metadata: { revisionId: rev.id, old: money(locked.amount), new: money(rev.newAmount), selfApproved: rev.proposedById === user.userId, note: b.note ?? null } });
      await this.s.publish(tx, { eventType: REVENUE_EVENTS.TARGET_REVISION_DECIDED, aggregateType: 'target', aggregateId: id, organizationId: user.organizationId, payload: { targetId: id, revisionId: rev.id, decision: b.decision, decidedById: user.userId, role: primaryRole(user) }, idempotencyKey: `target.revision_decided:${rev.id}` });
    });
    return this.get(user, id);
  }

  // ---- breakdown -------------------------------------------------------------------------------------------------
  async breakdown(user: Principal, id: string) {
    const root = await this.loadTarget(user, id);
    const summaryOnly = this.s.access.isSummaryOnly(user, 'targets:view');
    const level = this.s.access.scopeLevel(user, 'targets:view');
    const visible = level === 'team' ? new Set((await this.s.access.visibleUsers(user)).ids) : level === 'own' ? new Set([user.userId]) : null;
    const all: Target[] = [];
    let frontier = [root.id];
    for (let depth = 0; depth < 4 && frontier.length; depth += 1) {
      const kids = await this.prisma.target.findMany({ where: { organizationId: user.organizationId, parentId: { in: frontier } } });
      all.push(...kids);
      frontier = kids.map((k) => k.id);
    }
    const names = await this.s.userNames([root.ownerUserId, ...all.map((k) => k.ownerUserId)]);
    const byParent = new Map<string, Target[]>();
    for (const k of all) byParent.set(k.parentId!, [...(byParent.get(k.parentId!) ?? []), k]);
    const node = (t: Target): Record<string, unknown> => {
      const kids = byParent.get(t.id) ?? [];
      const childrenSum = sum(kids.map((k) => k.amount));
      const gap = D(t.amount).minus(childrenSum);
      const shown = kids.filter((k) => !visible || visible.has(k.ownerUserId));
      const fmt = (v: Prisma.Decimal) => (t.metric === 'ENROLMENT' ? v.toFixed(0) : money(v));
      return {
        id: t.id,
        level: t.level,
        ownerUserId: summaryOnly ? null : t.ownerUserId,
        ownerName: summaryOnly ? null : names.get(t.ownerUserId) ?? null,
        amount: fmt(D(t.amount)),
        originalAmount: fmt(D(t.originalAmount)),
        childrenSum: fmt(childrenSum),
        unallocated: fmt(gap),
        hasChildren: kids.length > 0,
        hiddenChildren: kids.length - shown.length,
        /** 'CONSISTENT' = children sum exactly to the parent; 'UNDER_ALLOCATED' = room left; 'OVER_ALLOCATED' cannot be stored but is checked */
        consistency: kids.length === 0 ? 'NO_BREAKDOWN' : gap.isZero() ? 'CONSISTENT' : gap.isPositive() ? 'UNDER_ALLOCATED' : 'OVER_ALLOCATED',
        children: shown.map(node),
      };
    };
    return { periodId: root.periodId, metric: root.metric, currency: root.currency, root: node(root) };
  }

  // ---- achievement (daily tracking) ------------------------------------------------------------------------------
  async achievement(user: Principal, id: string, q: z.infer<typeof asOfQuerySchema>) {
    const t = await this.loadTarget(user, id);
    const startsOn = isoDay(t.period.startsOn)!;
    const endsOn = isoDay(t.period.endsOn)!;
    const today = todayIst();
    const asOfRaw = q.asOf ?? today;
    const asOf = asOfRaw < startsOn ? startsOn : asOfRaw > endsOn ? endsOn : asOfRaw;
    const win = istRange(startsOn, asOf);
    const userIds = t.level === 'FOUNDER' ? null : new Set(t.level === 'EXECUTIVE' ? [t.ownerUserId] : await this.s.subtreeUserIds(user.organizationId, t.ownerUserId));
    const revisions = await this.prisma.targetRevision.findMany({ where: { targetId: id } });
    const asOfTarget = targetAsOf(revisions.map((r) => ({ seq: r.seq, status: r.status, newAmount: r.newAmount, effectiveFrom: isoDay(r.effectiveFrom)! })), asOf) ?? D(t.amount);
    let actual = ZERO;
    let detail: Record<string, string | number> = {};
    let daily;
    if (t.metric === 'REVENUE') {
      const r = await this.metrics.revenue(user.organizationId, win, userIds);
      actual = r.net;
      detail = { booked: money(r.booked), refundsApproved: money(r.refundedApproved), wonDeals: r.wonCount };
      daily = await this.metrics.revenueDaily(user.organizationId, win, startsOn, asOf, userIds);
    } else if (t.metric === 'COLLECTION') {
      const r = await this.metrics.collections(user.organizationId, win, userIds);
      actual = r.net;
      detail = { verifiedCollections: money(r.verified), refundsProcessed: money(r.refunded) };
      daily = await this.metrics.collectionsDaily(user.organizationId, win, startsOn, asOf, userIds);
    } else {
      const r = await this.metrics.revenue(user.organizationId, win, userIds);
      actual = D(r.enrolments.toString());
      detail = { wonDeals: r.wonCount };
      const items = r.sales.filter((s) => s.closedAt >= win.from && s.closedAt < win.to && (!userIds || s.credits.some((c) => userIds.has(c.userId)))).map((s) => ({ at: s.closedAt, amount: D(s.enrolments.toString()) }));
      daily = dailySeries(items, startsOn, asOf);
    }
    const fmt = (v: Prisma.Decimal) => (t.metric === 'ENROLMENT' ? v.toFixed(0) : money(v));
    return {
      targetId: t.id,
      metric: t.metric,
      level: t.level,
      currency: t.currency,
      period: this.serializePeriod(t.period),
      asOf,
      target: fmt(asOfTarget),
      originalTarget: fmt(D(t.originalAmount)),
      currentTarget: fmt(D(t.amount)),
      actual: fmt(actual),
      achievementPct: achievementPct(actual, asOfTarget),
      noTargetSet: asOfTarget.isZero(),
      pacing: pacing(asOfTarget, actual, startsOn, endsOn, asOf),
      detail,
      daily,
      definition: t.metric === 'REVENUE' ? 'KPI-REV-001: booked sales (net of approved adjustments and approved refunds), credited per DEC-005' : t.metric === 'COLLECTION' ? 'KPI-REV-002: verified collections net of processed refunds, credited per DEC-004' : 'Won enrolments in the period, credited per DEC-005',
      isEstimate: false,
    };
  }
}

