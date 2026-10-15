import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { COMPLAINT_ACTIVE_STATUSES, COMPLAINT_RULES, complaintDeadlines, emitCx, findRule, logState, missingRequired, ruleAllows, ROOT_CAUSE_CATEGORIES, type ComplaintPriorityKey } from '@salesos/cx-core';
import { CX_EVENTS } from '@salesos/shared-types';
import type { complaintTransitionSchema, complaintTrendsQuerySchema, createComplaintSchema, listComplaintsQuerySchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService, type Tx } from '../../../common/prisma';
import { assertOrgRefs, assertOrgUsers, canActOnUser, cxConfig, fieldsRequired, illegalTransition, loadVisibleLead, scopedByUsers, userNameMap, withData } from '../common/support';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
type Row = Prisma.ComplaintGetPayload<object>;

@Injectable()
export class ComplaintsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  private view(c: Row, names: Map<string, string>, learner: { id: string; name: string } | null, now = new Date()) {
    const open = (COMPLAINT_ACTIVE_STATUSES as string[]).includes(c.status);
    return {
      id: c.id, title: c.title, description: c.description, category: c.category, priority: c.priority, status: c.status,
      learner, leadId: c.leadId, dealId: c.dealId, refundId: c.refundId,
      ownerId: c.ownerId, ownerName: names.get(c.ownerId) ?? null, createdById: c.createdById, createdByName: names.get(c.createdById) ?? null,
      autoAssigned: c.autoAssigned, isHighValue: c.isHighValue,
      sla: {
        startedAt: c.slaStartedAt, firstResponseDueAt: c.firstResponseDueAt, resolutionDueAt: c.resolutionDueAt,
        firstResponseBreachedAt: c.firstResponseBreachedAt, resolutionBreachedAt: c.resolutionBreachedAt, breachLevel: c.breachLevel,
        firstResponseRemainingMs: open && !c.acknowledgedAt ? c.firstResponseDueAt.getTime() - now.getTime() : null,
        resolutionRemainingMs: open ? c.resolutionDueAt.getTime() - now.getTime() : null,
        resolvedWithinSla: c.resolvedWithinSla,
      },
      acknowledgedAt: c.acknowledgedAt, firstResponseNote: c.firstResponseNote,
      escalatedAt: c.escalatedAt, escalatedToId: c.escalatedToId, escalatedToName: c.escalatedToId ? names.get(c.escalatedToId) ?? null : null, escalationReason: c.escalationReason,
      resolvedAt: c.resolvedAt, resolution: c.resolution, rootCauseCategory: c.rootCauseCategory,
      closedAt: c.closedAt, closeReason: c.closeReason, closedAsInvalid: c.closedAsInvalid, reopenCount: c.reopenCount,
      version: c.version, createdAt: c.createdAt, updatedAt: c.updatedAt,
    };
  }

  private async learners(orgId: string, ids: Array<string | null>) {
    const uniq = [...new Set(ids.filter((i): i is string => !!i))];
    if (!uniq.length) return new Map<string, { id: string; name: string }>();
    const rows = await this.prisma.lead.findMany({ where: { organizationId: orgId, id: { in: uniq } }, select: { id: true, fullName: true } });
    return new Map(rows.map((r) => [r.id, { id: r.id, name: r.fullName }]));
  }

  private async where(user: Principal): Promise<Prisma.ComplaintWhereInput> {
    return (await scopedByUsers(this.access, user, 'complaints:view', ['ownerId', 'createdById'])) as Prisma.ComplaintWhereInput;
  }

  async list(user: Principal, q: Dto<typeof listComplaintsQuerySchema>) {
    const filters: Prisma.ComplaintWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.leadId ? { leadId: q.leadId } : {}),
      ...(q.open === true ? { status: { in: COMPLAINT_ACTIVE_STATUSES } } : {}),
      ...(q.breached === true ? { OR: [{ firstResponseBreachedAt: { not: null } }, { resolutionBreachedAt: { not: null } }], status: { in: COMPLAINT_ACTIVE_STATUSES } } : {}),
      ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const rows = await this.prisma.complaint.findMany({ where: { AND: [await this.where(user), filters] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((c) => [c.ownerId, c.createdById, c.escalatedToId]));
    const learners = await this.learners(user.organizationId, res.data.map((c) => c.leadId));
    const now = new Date();
    return withData(res, res.data.map((c) => this.view(c, names, c.leadId ? learners.get(c.leadId) ?? null : null, now)));
  }

  private async load(user: Principal, id: string, key: 'complaints:view' | 'complaints:update' = 'complaints:view'): Promise<Row> {
    const scoped = key === 'complaints:view' ? await this.where(user) : ((await scopedByUsers(this.access, user, key, ['ownerId', 'createdById'])) as Prisma.ComplaintWhereInput);
    const c = await this.prisma.complaint.findFirst({ where: { AND: [scoped, { id }] } });
    if (!c) throw notFound('Complaint');
    return c;
  }

  async get(user: Principal, id: string) {
    const c = await this.load(user, id);
    const names = await userNameMap(this.prisma, user.organizationId, [c.ownerId, c.createdById, c.escalatedToId]);
    const learners = await this.learners(user.organizationId, [c.leadId]);
    const history = await this.prisma.cxStateLog.findMany({ where: { organizationId: user.organizationId, entityType: 'complaint', entityId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const hn = await userNameMap(this.prisma, user.organizationId, history.map((h) => h.actorId));
    return {
      ...this.view(c, names, c.leadId ? learners.get(c.leadId) ?? null : null),
      history: history.map((h) => ({ from: h.fromStatus, to: h.toStatus, actorName: h.actorId ? hn.get(h.actorId) ?? null : 'System', note: h.note, at: h.createdAt })),
    };
  }

  async create(user: Principal, dto: Dto<typeof createComplaintSchema>) {
    const lead = dto.leadId ? await loadVisibleLead(this.prisma, this.access, user, dto.leadId) : null;
    await assertOrgRefs(this.prisma, user.organizationId, { dealId: dto.dealId, refundId: dto.refundId });
    let ownerId = dto.ownerId ?? null;
    let autoAssigned = false;
    if (ownerId) {
      await assertOrgUsers(this.prisma, user.organizationId, [ownerId]);
      if (!(await canActOnUser(this.access, user, 'complaints:create', ownerId))) throw notFound('Owner');
    } else {
      // state machine failure handling: missing owner -> auto-assign to the creator's manager, flagged
      const mgr = user.managerId ? await this.prisma.user.findFirst({ where: { id: user.managerId, organizationId: user.organizationId, isActive: true }, select: { id: true } }) : null;
      ownerId = mgr?.id ?? user.userId;
      autoAssigned = true;
    }
    const { cfg, wh } = await cxConfig(this.prisma, user.organizationId);
    const now = new Date();
    const dl = complaintDeadlines(dto.priority as ComplaintPriorityKey, now, cfg, wh);
    const id = await this.prisma.$transaction(async (tx) => {
      const c = await tx.complaint.create({
        data: {
          organizationId: user.organizationId, leadId: dto.leadId ?? null, dealId: dto.dealId ?? null, refundId: dto.refundId ?? null,
          title: dto.title, description: dto.description, category: dto.category, priority: dto.priority, ownerId: ownerId!, createdById: user.userId,
          teamId: lead?.teamId ?? null, autoAssigned, isHighValue: lead?.isKeyProspect ?? false,
          slaStartedAt: now, firstResponseDueAt: dl.firstResponseDueAt, resolutionDueAt: dl.resolutionDueAt,
        },
      });
      await logState(tx, { organizationId: user.organizationId, entityType: 'complaint', entityId: c.id, from: null, to: 'OPEN', actorId: user.userId });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'complaint.created', entityType: 'complaint', entityId: c.id, metadata: { priority: c.priority, category: c.category, ownerId: c.ownerId, autoAssigned } });
      await emitCx(tx, {
        organizationId: user.organizationId, eventType: CX_EVENTS.COMPLAINT_CREATED, aggregateType: 'complaint', aggregateId: c.id, key: `complaint.created:${c.id}`,
        payload: { organizationId: user.organizationId, complaintId: c.id, status: 'OPEN', priority: c.priority, ownerId: c.ownerId, leadId: c.leadId, actorId: user.userId, notifyUserIds: [c.ownerId].filter((u) => u !== user.userId), ...(c.priority === 'P1' ? { notifyRoles: ['SALES_TEAM_LEAD'] } : {}) },
      });
      return c.id;
    });
    return this.get(user, id);
  }

  async transition(user: Principal, id: string, dto: Dto<typeof complaintTransitionSchema>) {
    const c = await this.load(user, id, 'complaints:update');
    const rule = findRule(COMPLAINT_RULES, c.status, dto.to);
    if (!rule) throw illegalTransition(c.status, dto.to);
    if (!ruleAllows(rule, { roles: user.roles, isOwner: c.ownerId === user.userId })) throw new AppError('FORBIDDEN', 'Your role cannot perform this transition on this complaint', 403);
    const input: Record<string, unknown> = { ...dto };
    const missing = missingRequired(rule, input);
    if (missing.length) throw fieldsRequired(missing);
    if (dto.to === 'RESOLVED' && !(ROOT_CAUSE_CATEGORIES as readonly string[]).includes(dto.rootCauseCategory ?? '')) throw fieldsRequired(['rootCauseCategory']);
    if (dto.to === 'ESCALATED') await assertOrgUsers(this.prisma, user.organizationId, [dto.escalatedToId!]);
    if (dto.refundId) await assertOrgRefs(this.prisma, user.organizationId, { refundId: dto.refundId });

    const now = new Date();
    const data: Prisma.ComplaintUncheckedUpdateManyInput = { status: dto.to, version: { increment: 1 } };
    let note = dto.note ?? dto.reason ?? null;
    let eventType: string = CX_EVENTS.COMPLAINT_UPDATED;
    let notifyUserIds: string[] = [c.ownerId];
    let notifyRoles: string[] | undefined;
    switch (dto.to) {
      case 'ACKNOWLEDGED':
        data.acknowledgedAt = now; data.firstResponseNote = dto.note; eventType = CX_EVENTS.COMPLAINT_ACKNOWLEDGED; notifyUserIds = [c.createdById];
        break;
      case 'ESCALATED':
        data.escalatedAt = now; data.escalatedToId = dto.escalatedToId; data.escalationReason = dto.reason; eventType = CX_EVENTS.COMPLAINT_ESCALATED;
        notifyUserIds = [dto.escalatedToId!, c.ownerId]; notifyRoles = c.priority === 'P1' || c.isHighValue ? ['SALES_TEAM_LEAD', 'FOUNDER_CEO'] : ['SALES_TEAM_LEAD'];
        break;
      case 'RESOLVED':
        data.resolvedAt = now; data.resolution = dto.resolution; data.rootCauseCategory = dto.rootCauseCategory; data.resolvedWithinSla = now.getTime() <= c.resolutionDueAt.getTime();
        if (dto.refundId) data.refundId = dto.refundId;
        eventType = CX_EVENTS.COMPLAINT_RESOLVED; notifyUserIds = [c.createdById]; note = dto.resolution ?? note;
        break;
      case 'CLOSED':
        data.closedAt = now; data.closeReason = dto.reason ?? (c.status === 'RESOLVED' ? 'Closed after resolution' : null); data.closedAsInvalid = c.status === 'OPEN' ? (dto.invalid ?? true) : false; eventType = CX_EVENTS.COMPLAINT_CLOSED;
        break;
      case 'REOPENED': {
        const { cfg, wh } = await cxConfig(this.prisma, user.organizationId);
        const dl = complaintDeadlines(c.priority as ComplaintPriorityKey, now, cfg, wh);
        // SLA restarts with a NEW clock; the previous breach history stays in the state log / audit trail
        Object.assign(data, { reopenCount: { increment: 1 }, slaStartedAt: now, firstResponseDueAt: dl.firstResponseDueAt, resolutionDueAt: dl.resolutionDueAt, acknowledgedAt: null, firstResponseBreachedAt: null, resolutionBreachedAt: null, breachLevel: 0, resolvedAt: null, resolvedWithinSla: null, closedAt: null });
        eventType = CX_EVENTS.COMPLAINT_REOPENED; notifyRoles = ['SALES_TEAM_LEAD'];
        break;
      }
      default:
        break;
    }
    await this.prisma.$transaction(async (tx: Tx) => {
      const res = await tx.complaint.updateMany({ where: { id, status: c.status, version: c.version }, data });
      if (res.count !== 1) throw conflict('CONFLICT', 'The complaint was changed by someone else; reload and retry');
      await logState(tx, { organizationId: user.organizationId, entityType: 'complaint', entityId: id, from: c.status, to: dto.to, actorId: user.userId, note, metadata: dto.to === 'ESCALATED' ? { escalatedToId: dto.escalatedToId } : dto.to === 'RESOLVED' ? { rootCauseCategory: dto.rootCauseCategory } : {} });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: rule.audit, entityType: 'complaint', entityId: id, metadata: { from: c.status, to: dto.to, priority: c.priority } });
      await emitCx(tx, {
        organizationId: user.organizationId, eventType, aggregateType: 'complaint', aggregateId: id, key: `${eventType}:${id}:${c.version + 1}`,
        payload: { organizationId: user.organizationId, complaintId: id, status: dto.to, priority: c.priority, ownerId: c.ownerId, leadId: c.leadId, actorId: user.userId, notifyUserIds: notifyUserIds.filter((u) => u !== user.userId), ...(notifyRoles ? { notifyRoles } : {}) },
      });
      if (dto.to === 'RESOLVED') {
        // satisfaction survey scheduled after resolution (state machine side effect); Phase 8 delivers it, capture is manual until then
        await emitCx(tx, { organizationId: user.organizationId, eventType: CX_EVENTS.SURVEY_REQUESTED, aggregateType: 'complaint', aggregateId: id, key: `survey.requested:complaint:${id}:${c.version + 1}`, payload: { organizationId: user.organizationId, kind: 'CSAT', complaintId: id, leadId: c.leadId } });
      }
    });
    return this.get(user, id);
  }

  /** Trend queries (JD-CX-008): volume, resolution, SLA adherence, root causes and categories over time. Scoped by complaints:view. */
  async trends(user: Principal, q: Dto<typeof complaintTrendsQuerySchema>) {
    const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00.000Z`) : new Date(to.getTime() - 180 * 86_400_000);
    if (from > to) throw new AppError('VALIDATION_ERROR', '`from` must be before `to`', 400);
    const rows = await this.prisma.complaint.findMany({
      where: { AND: [await this.where(user), { createdAt: { gte: from, lte: to } }] },
      select: { createdAt: true, resolvedAt: true, status: true, priority: true, category: true, rootCauseCategory: true, resolvedWithinSla: true, closedAsInvalid: true, firstResponseBreachedAt: true, resolutionBreachedAt: true },
      take: 20_000,
    });
    const counted = rows.filter((r) => !r.closedAsInvalid);
    const bucketKey = (d: Date) => {
      if (q.bucket === 'month') return d.toISOString().slice(0, 7);
      const dow = (d.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
    };
    const buckets = new Map<string, { bucket: string; opened: number; resolved: number; resolvedWithinSla: number; breached: number }>();
    for (const r of counted) {
      const k = bucketKey(r.createdAt);
      const b = buckets.get(k) ?? { bucket: k, opened: 0, resolved: 0, resolvedWithinSla: 0, breached: 0 };
      b.opened += 1;
      if (r.resolvedAt || r.status === 'CLOSED') b.resolved += 1;
      if (r.resolvedWithinSla) b.resolvedWithinSla += 1;
      if (r.firstResponseBreachedAt || r.resolutionBreachedAt) b.breached += 1;
      buckets.set(k, b);
    }
    const count = (key: 'rootCauseCategory' | 'category' | 'priority') => {
      const m = new Map<string, number>();
      for (const r of counted) {
        const v = r[key];
        if (v) m.set(v, (m.get(v) ?? 0) + 1);
      }
      return [...m.entries()].map(([k, n]) => ({ key: k, count: n })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    };
    const resolvedRows = counted.filter((r) => r.resolvedAt);
    const hours = resolvedRows.map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 3_600_000).sort((a, b) => a - b);
    const mean = hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null;
    const median = hours.length ? Math.round(hours[Math.floor((hours.length - 1) / 2)]! * 10) / 10 : null;
    return {
      from: from.toISOString(), to: to.toISOString(), bucket: q.bucket,
      totals: {
        opened: counted.length, excludedInvalid: rows.length - counted.length, resolved: resolvedRows.length,
        resolutionRatePct: counted.length ? Math.round((resolvedRows.length / counted.length) * 1000) / 10 : null,
        slaAdherencePct: resolvedRows.length ? Math.round((resolvedRows.filter((r) => r.resolvedWithinSla).length / resolvedRows.length) * 1000) / 10 : null,
        meanHoursToResolve: mean, medianHoursToResolve: median,
      },
      series: [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
      byRootCause: count('rootCauseCategory'), byCategory: count('category'), byPriority: count('priority'),
    };
  }
}
