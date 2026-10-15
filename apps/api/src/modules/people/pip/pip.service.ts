import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PEOPLE_EVENTS, PLATFORM_EVENTS } from '@salesos/shared-types';
import type { createPipSchema, listPipsQuerySchema, pipApproveSchema, pipTransitionSchema, updateCheckpointSchema, updatePipDraftSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, forbidden, notFound } from '../../../common/http/errors';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService, type Tx } from '../../../common/prisma';
import { addDays, assertOrgUsers, assertTargetInScope, hasRole, isoDay, todayUtc, toDate, userNameMap, asPage } from '../common/helpers';
import { findPipRule, PIP_MAX_EXTENSIONS, PIP_TERMINAL, type PipState } from './pip-machine';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
type PipRow = Prisma.ImprovementPlanGetPayload<{ include: { checkpoints: true } }>;

@Injectable()
export class PipService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  /** Employees never see their own DRAFT; everyone else follows pip:view scope. */
  private async where(user: Principal): Promise<Prisma.ImprovementPlanWhereInput> {
    const base = await this.access.scopedWhere(user, { permission: 'pip:view', ownerField: 'employeeId' });
    return { AND: [base as Prisma.ImprovementPlanWhereInput, { OR: [{ employeeId: { not: user.userId } }, { status: { not: 'DRAFT' } }] }] };
  }

  private view(p: PipRow, names: Map<string, string>) {
    return {
      id: p.id, employeeId: p.employeeId, employeeName: names.get(p.employeeId) ?? null, createdById: p.createdById, createdByName: names.get(p.createdById) ?? null,
      proposedByManager: p.proposedByManager, status: p.status, reason: p.reason, kpiGaps: p.kpiGaps, evidence: p.evidence, goals: p.goals, measures: p.measures, durationDays: p.durationDays,
      startDate: isoDay(p.startDate), endDate: isoDay(p.endDate), proposedEndDate: isoDay(p.proposedEndDate), extensionCount: p.extensionCount, extensionReason: p.extensionReason,
      approvedByName: p.approvedById ? names.get(p.approvedById) ?? null : null, approvedAt: p.approvedAt, employeeAcknowledgedAt: p.employeeAcknowledgedAt,
      finalReview: p.finalReview, recommendedAction: p.recommendedAction, cancelReason: p.cancelReason, version: p.version, updatedAt: p.updatedAt,
      checkpoints: p.checkpoints.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()).map((c) => ({ id: c.id, title: c.title, dueDate: isoDay(c.dueDate), status: c.status, notes: c.notes, completedAt: c.completedAt })),
    };
  }

  async list(user: Principal, q: Dto<typeof listPipsQuerySchema>) {
    const where: Prisma.ImprovementPlanWhereInput = { AND: [await this.where(user), { ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.status ? { status: q.status } : {}) }] };
    const rows = await this.prisma.improvementPlan.findMany({ where, include: { checkpoints: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((p) => [p.employeeId, p.createdById, p.approvedById]));
    return asPage(res, res.data.map((p) => this.view(p, names)));
  }

  private async load(user: Principal, id: string): Promise<PipRow> {
    const p = await this.prisma.improvementPlan.findFirst({ where: { AND: [await this.where(user), { id }] }, include: { checkpoints: true } });
    if (!p) throw notFound('Improvement plan');
    return p;
  }

  async get(user: Principal, id: string) {
    const p = await this.load(user, id);
    const names = await userNameMap(this.prisma, user.organizationId, [p.employeeId, p.createdById, p.approvedById]);
    const history = await this.prisma.peopleStateLog.findMany({ where: { organizationId: user.organizationId, entityType: 'pip', entityId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const hn = await userNameMap(this.prisma, user.organizationId, history.map((h) => h.actorId));
    return { ...this.view(p, names), history: history.map((h) => ({ from: h.fromStatus, to: h.toStatus, actorName: h.actorId ? hn.get(h.actorId) ?? null : null, note: h.note, at: h.createdAt })) };
  }

  private async log(tx: Tx, user: Principal, p: { id: string; employeeId: string }, from: string | null, to: string, audit: string, note?: string | null) {
    await tx.peopleStateLog.create({ data: { organizationId: user.organizationId, entityType: 'pip', entityId: p.id, fromStatus: from, toStatus: to, actorId: user.userId, note: note ?? null } });
    // PIP is HR data: audit metadata carries status only, never narrative text.
    await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: audit, entityType: 'improvement_plan', entityId: p.id, metadata: { employeeId: p.employeeId, from, to } });
    const eventType = audit === 'pip.submitted' ? PEOPLE_EVENTS.PIP_SUBMITTED : audit === 'pip.activated' ? PEOPLE_EVENTS.PIP_ACTIVATED : audit === 'pip.returned' ? PEOPLE_EVENTS.PIP_RETURNED : audit === 'pip.extended' ? PEOPLE_EVENTS.PIP_EXTENDED : audit === 'pip.completed' ? PEOPLE_EVENTS.PIP_COMPLETED : audit === 'pip.cancelled' ? PEOPLE_EVENTS.PIP_CANCELLED : audit === 'pip.created' || audit === 'pip.proposed' ? PEOPLE_EVENTS.PIP_CREATED : null;
    if (eventType) {
      await this.outbox.publish(tx, {
        eventType, aggregateType: 'improvement_plan', aggregateId: p.id, organizationId: user.organizationId,
        payload: { pipId: p.id, organizationId: user.organizationId, employeeId: p.employeeId, from, to, actorId: user.userId },
        idempotencyKey: `${eventType}:${p.id}:${to}:${Date.now()}`,
      });
    }
  }

  async create(user: Principal, dto: Dto<typeof createPipSchema>) {
    if (dto.employeeId === user.userId) throw forbidden('You cannot create a plan for yourself');
    await assertOrgUsers(this.prisma, user.organizationId, [dto.employeeId]);
    if (!hasRole(user, 'HR')) await assertTargetInScope(this.access, user, 'pip:create', dto.employeeId);
    const open = await this.prisma.improvementPlan.findFirst({ where: { employeeId: dto.employeeId, status: { notIn: PIP_TERMINAL } } });
    if (open) throw conflict('PIP_ALREADY_OPEN', 'This employee already has an open improvement plan');
    const id = await this.prisma.$transaction(async (tx) => {
      const p = await tx.improvementPlan.create({ data: { organizationId: user.organizationId, employeeId: dto.employeeId, createdById: user.userId, reason: dto.reason, kpiGaps: dto.kpiGaps, evidence: dto.evidence } });
      await this.log(tx, user, p, null, 'DRAFT', 'pip.created');
      return p.id;
    });
    return this.get(user, id);
  }

  /**
   * Manager-proposed PIP (state-machines s9 "Mgr proposes"): a Sales Manager with pip:propose files a DRAFT for an employee in their own
   * team. It cannot be submitted or activated by the manager; the Team Lead / HR (pip:create) review the draft and submit it through
   * the normal machine. The Team Lead and HR are notified (no narrative text in the notification: PIP is HR data).
   */
  async propose(user: Principal, dto: Dto<typeof createPipSchema>) {
    if (dto.employeeId === user.userId) throw forbidden('You cannot propose a plan for yourself');
    await assertOrgUsers(this.prisma, user.organizationId, [dto.employeeId]);
    await assertTargetInScope(this.access, user, 'pip:propose', dto.employeeId);
    const open = await this.prisma.improvementPlan.findFirst({ where: { employeeId: dto.employeeId, status: { notIn: PIP_TERMINAL } } });
    if (open) throw conflict('PIP_ALREADY_OPEN', 'This employee already has an open improvement plan');
    const id = await this.prisma.$transaction(async (tx) => {
      const p = await tx.improvementPlan.create({ data: { organizationId: user.organizationId, employeeId: dto.employeeId, createdById: user.userId, proposedByManager: true, reason: dto.reason, kpiGaps: dto.kpiGaps, evidence: dto.evidence } });
      await this.log(tx, user, p, null, 'DRAFT', 'pip.proposed', 'Proposed by manager');
      await this.outbox.publish(tx, {
        eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'improvement_plan', aggregateId: p.id, organizationId: user.organizationId,
        payload: { organizationId: user.organizationId, type: 'review.pending', roles: ['SALES_TEAM_LEAD', 'HR'], entity: { type: 'improvement_plan', id: p.id }, dedupeKey: `pip.proposed:${p.id}`, actionUrl: `/people/pips/${p.id}`, title: 'Improvement plan proposed', body: 'A Sales Manager proposed an improvement plan. Review the draft and take it forward or return it.' },
        idempotencyKey: `notification.requested:pip.proposed:${p.id}`,
      });
      return p.id;
    });
    return this.get(user, id);
  }

  async updateDraft(user: Principal, id: string, dto: Dto<typeof updatePipDraftSchema>) {
    const p = await this.load(user, id);
    if (p.status !== 'DRAFT') throw conflict('PIP_LOCKED', 'Only draft plans can be edited');
    const { checkpoints, ...rest } = dto;
    await this.prisma.$transaction(async (tx) => {
      await tx.improvementPlan.update({ where: { id }, data: { ...rest, version: { increment: 1 } } });
      if (checkpoints) {
        await tx.pipCheckpoint.deleteMany({ where: { pipId: id } });
        await tx.pipCheckpoint.createMany({ data: checkpoints.map((c) => ({ organizationId: user.organizationId, pipId: id, dueDate: toDate(c.dueDate), title: c.title })) });
      }
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'pip.updated', entityType: 'improvement_plan', entityId: id, metadata: { employeeId: p.employeeId, fields: Object.keys(dto) } });
    });
    return this.get(user, id);
  }

  private requireRole(user: Principal, rule: NonNullable<ReturnType<typeof findPipRule>>) {
    if (!rule.roles.some((r) => user.roles.includes(r))) throw forbidden('Your role cannot perform this transition');
    if (rule.needsApprovePermission && !this.access.has(user, 'pip:approve')) throw forbidden();
  }

  /** Non-approver transitions: submit, request extension, complete, cancel. */
  async transition(user: Principal, id: string, dto: Dto<typeof pipTransitionSchema>) {
    const p = await this.load(user, id);
    const rule = findPipRule(p.status, dto.to);
    if (!rule || ['ACTIVE'].includes(dto.to)) throw new AppError('ILLEGAL_TRANSITION', `Cannot move a plan from ${p.status} to ${dto.to}`, 409);
    this.requireRole(user, rule);
    if (p.employeeId === user.userId) throw forbidden('You cannot act on your own plan');
    if (!hasRole(user, 'HR', 'FOUNDER_CEO')) await assertTargetInScope(this.access, user, 'pip:update', p.employeeId);

    const data: Prisma.ImprovementPlanUpdateManyMutationInput = {};
    let note: string | null = null;
    switch (dto.to) {
      case 'PENDING_APPROVAL':
        if (!Array.isArray(p.goals) || (p.goals as unknown[]).length === 0 || !Array.isArray(p.measures) || (p.measures as unknown[]).length === 0 || p.checkpoints.length === 0) {
          throw new AppError('PIP_INCOMPLETE', 'Goals, measures and at least one checkpoint are required before submitting', 422);
        }
        break;
      case 'EXTENDED': {
        if (p.extensionCount >= PIP_MAX_EXTENSIONS) throw new AppError('PIP_EXTENSION_LIMIT', 'A plan can be extended only once', 422);
        const newEnd = toDate(dto.newEndDate);
        if (!p.endDate || newEnd.getTime() <= p.endDate.getTime()) throw new AppError('VALIDATION_ERROR', 'The new end date must be after the current end date', 400);
        data.extensionReason = dto.reason;
        data.proposedEndDate = newEnd;
        note = dto.reason;
        break;
      }
      case 'COMPLETED_SUCCESS':
        data.finalReview = dto.finalReview;
        if (dto.evidence) data.evidence = dto.evidence;
        break;
      case 'COMPLETED_NOT_IMPROVED':
        data.finalReview = dto.finalReview;
        data.recommendedAction = dto.recommendedAction;
        if (dto.evidence) data.evidence = dto.evidence;
        break;
      case 'CANCELLED':
        data.cancelReason = dto.reason;
        note = dto.reason;
        break;
      default:
        throw new AppError('ILLEGAL_TRANSITION', 'Unsupported transition', 409);
    }
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.improvementPlan.updateMany({ where: { id, status: p.status, version: p.version }, data: { ...data, status: dto.to as PipState, version: { increment: 1 } } });
      if (res.count !== 1) throw conflict('STALE_STATE', 'The plan changed; reload and retry');
      await this.log(tx, user, p, p.status, dto.to, rule.audit, note);
    });
    return this.get(user, id);
  }

  /** Approver actions (Founder / HR): start (needs employee acknowledgement), return to draft, or decide on an extension. */
  async approve(user: Principal, id: string, dto: Dto<typeof pipApproveSchema>) {
    const p = await this.load(user, id);
    if (p.employeeId === user.userId) throw forbidden('You cannot approve your own plan');
    if (p.status === 'PENDING_APPROVAL') {
      const rule = findPipRule('PENDING_APPROVAL', dto.decision === 'APPROVE' ? 'ACTIVE' : 'DRAFT')!;
      this.requireRole(user, rule);
      if (dto.decision === 'RETURN') {
        await this.prisma.$transaction(async (tx) => {
          const res = await tx.improvementPlan.updateMany({ where: { id, status: 'PENDING_APPROVAL', version: p.version }, data: { status: 'DRAFT', employeeAcknowledgedAt: null, version: { increment: 1 } } });
          if (res.count !== 1) throw conflict('STALE_STATE', 'The plan changed; reload and retry');
          await this.log(tx, user, p, 'PENDING_APPROVAL', 'DRAFT', 'pip.returned', dto.note);
        });
        return this.get(user, id);
      }
      if (!p.employeeAcknowledgedAt) {
        await this.outbox.publishStandalone({
          eventType: PEOPLE_EVENTS.PIP_ACK_REMINDER, aggregateType: 'improvement_plan', aggregateId: id, organizationId: user.organizationId,
          payload: { pipId: id, employeeId: p.employeeId }, idempotencyKey: `pip-ack-reminder:${id}:${new Date().toISOString().slice(0, 13)}`,
        });
        throw new AppError('PIP_ACK_REQUIRED', 'The employee must acknowledge the plan before it can start; a reminder was queued', 409);
      }
      const start = dto.startDate ? toDate(dto.startDate) : todayUtc();
      const end = addDays(start, p.durationDays);
      await this.prisma.$transaction(async (tx) => {
        const res = await tx.improvementPlan.updateMany({ where: { id, status: 'PENDING_APPROVAL', version: p.version }, data: { status: 'ACTIVE', approvedById: user.userId, approvedAt: new Date(), startDate: start, endDate: end, version: { increment: 1 } } });
        if (res.count !== 1) throw conflict('STALE_STATE', 'The plan changed; reload and retry');
        // Checkpoint tasks: one coaching action per checkpoint, owned by the employee, so progress is tracked.
        for (const c of p.checkpoints) {
          await tx.coachingAction.create({ data: { organizationId: user.organizationId, ownerId: p.employeeId, title: `PIP checkpoint: ${c.title}`, dueDate: c.dueDate, sourceRef: `pip:${id}`, createdById: user.userId } });
        }
        await this.log(tx, user, p, 'PENDING_APPROVAL', 'ACTIVE', 'pip.activated', dto.note);
      });
      return this.get(user, id);
    }
    if (p.status === 'EXTENDED') {
      const rule = findPipRule('EXTENDED', 'ACTIVE')!;
      this.requireRole(user, rule);
      if (dto.decision === 'APPROVE' && p.extensionCount >= PIP_MAX_EXTENSIONS) throw new AppError('PIP_EXTENSION_LIMIT', 'A plan can be extended only once', 422);
      await this.prisma.$transaction(async (tx) => {
        const res = await tx.improvementPlan.updateMany({
          where: { id, status: 'EXTENDED', version: p.version },
          data: dto.decision === 'APPROVE'
            ? { status: 'ACTIVE', endDate: p.proposedEndDate, proposedEndDate: null, extensionCount: { increment: 1 }, version: { increment: 1 } }
            : { status: 'ACTIVE', proposedEndDate: null, version: { increment: 1 } },
        });
        if (res.count !== 1) throw conflict('STALE_STATE', 'The plan changed; reload and retry');
        await this.log(tx, user, p, 'EXTENDED', 'ACTIVE', dto.decision === 'APPROVE' ? 'pip.extended' : 'pip.extension_declined', dto.note);
      });
      return this.get(user, id);
    }
    throw new AppError('ILLEGAL_TRANSITION', `Nothing to approve in status ${p.status}`, 409);
  }

  async acknowledge(user: Principal, id: string) {
    const p = await this.load(user, id);
    if (p.employeeId !== user.userId) throw forbidden('Only the employee can acknowledge their plan');
    if (!['PENDING_APPROVAL', 'ACTIVE', 'EXTENDED'].includes(p.status)) throw conflict('ILLEGAL_STATE', `Cannot acknowledge a ${p.status} plan`);
    if (p.employeeAcknowledgedAt) return this.get(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.improvementPlan.update({ where: { id }, data: { employeeAcknowledgedAt: new Date() } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'pip.acknowledged', entityType: 'improvement_plan', entityId: id, metadata: { employeeId: p.employeeId } });
    });
    return this.get(user, id);
  }

  async updateCheckpoint(user: Principal, id: string, cid: string, dto: Dto<typeof updateCheckpointSchema>) {
    const p = await this.load(user, id);
    if (!['ACTIVE', 'EXTENDED'].includes(p.status)) throw conflict('ILLEGAL_STATE', 'Checkpoints can only be updated on an active plan');
    if (p.employeeId === user.userId) throw forbidden('You cannot update checkpoints on your own plan');
    if (!hasRole(user, 'HR')) await assertTargetInScope(this.access, user, 'pip:update', p.employeeId);
    const c = p.checkpoints.find((x) => x.id === cid);
    if (!c) throw notFound('Checkpoint');
    await this.prisma.$transaction(async (tx) => {
      await tx.pipCheckpoint.update({ where: { id: cid }, data: { status: dto.status, notes: dto.notes, completedAt: dto.status === 'DONE' ? new Date() : null } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'pip.checkpoint_updated', entityType: 'improvement_plan', entityId: id, metadata: { employeeId: p.employeeId, checkpointId: cid, status: dto.status } });
    });
    return this.get(user, id);
  }
}
