import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { createHandoverFromTrigger, emitCx, findRule, handoverChecklist, HANDOVER_RULES, logState, missingHandoverFields, missingRequired, ruleAllows } from '@salesos/cx-core';
import { CX_EVENTS } from '@salesos/shared-types';
import type { acknowledgeHandoverSchema, completeHandoverSchema, createHandoverSchema, listHandoversQuerySchema, requestHandoverInfoSchema, updateHandoverSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { assertOrgUsers, canActOnUser, cxConfig, fieldsRequired, hasRole, illegalTransition, money, scopedByUsers, userNameMap, withData } from '../common/support';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
type Row = Prisma.HandoverRecordGetPayload<object>;

@Injectable()
export class HandoverService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  /**
   * Visibility: sales roles see handovers of their scope; STUDENT_SUCCESS (org) sees only SUBMITTED-and-later handovers
   * (drafts are the seller's workspace); summary scope (Operations) gets a status-only projection.
   */
  private async where(user: Principal): Promise<Prisma.HandoverRecordWhereInput> {
    const base = (await scopedByUsers(this.access, user, 'handover:view', ['ownerId', 'createdById', 'receivingOwnerId'])) as Prisma.HandoverRecordWhereInput;
    const salesSide = hasRole(user, 'FOUNDER_CEO', 'SALES_TEAM_LEAD', 'SALES_MANAGER', 'SALES_EXECUTIVE');
    return salesSide ? base : { AND: [base, { status: { not: 'DRAFT' } }] };
  }

  private async view(user: Principal, rows: Row[], cfgRequired: readonly string[]) {
    const summary = this.access.isSummaryOnly(user, 'handover:view');
    const names = await userNameMap(this.prisma, user.organizationId, rows.flatMap((r) => [r.ownerId, r.receivingOwnerId]));
    const salesSide = hasRole(user, 'FOUNDER_CEO', 'SALES_TEAM_LEAD', 'SALES_MANAGER', 'SALES_EXECUTIVE');
    return rows.map((r) => {
      const checklist = handoverChecklist({ ...r, amountPaid: r.amountPaid, amountDue: r.amountDue }, cfgRequired as never);
      const pending = r.status === 'SUBMITTED' || r.status === 'OVERDUE';
      const common = { id: r.id, status: r.status, programName: r.programName, ownerName: names.get(r.ownerId) ?? null, submittedAt: r.submittedAt, ackDueAt: r.ackDueAt, overdueAt: r.overdueAt, acknowledgedAt: r.acknowledgedAt, completedAt: r.completedAt, createdAt: r.createdAt, pending };
      if (summary) return { ...common, minimumData: true };
      return {
        ...common, minimumData: false,
        ...(salesSide ? { dealId: r.dealId, leadId: r.leadId, programId: r.programId, ownerId: r.ownerId } : {}),
        receivingOwnerId: r.receivingOwnerId, receivingOwnerName: r.receivingOwnerId ? names.get(r.receivingOwnerId) ?? null : null,
        learnerName: r.learnerName, learnerContact: r.learnerContact, languagePreference: r.languagePreference,
        amountPaid: money(r.amountPaid), amountDue: money(r.amountDue), currency: r.currency, paymentVerified: r.paymentVerified,
        promisesMade: r.promisesMade, goals: r.goals, objections: r.objections, specialNotes: r.specialNotes, consents: r.consents, attachmentFileIds: r.attachmentFileIds,
        infoRequest: r.infoRequest, infoRequestedAt: r.infoRequestedAt, completionNote: r.completionNote, overdueLevel: r.overdueLevel,
        checklist, missing: checklist.filter((c) => !c.done).map((c) => c.key), complete: checklist.every((c) => c.done), version: r.version,
      };
    });
  }

  async template(user: Principal) {
    const { cfg } = await cxConfig(this.prisma, user.organizationId);
    return { requiredFields: cfg.handover.requiredFields, ackSlaHours: cfg.handover.ackSlaHours, languages: ['EN', 'HI', 'MR'] };
  }

  async list(user: Principal, q: Dto<typeof listHandoversQuerySchema>) {
    const f: Prisma.HandoverRecordWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.ownerId ? { ownerId: q.ownerId } : {}), ...(q.pending === true ? { status: { in: ['SUBMITTED', 'OVERDUE'] } } : {}) };
    const rows = await this.prisma.handoverRecord.findMany({ where: { AND: [await this.where(user), f] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const { cfg } = await cxConfig(this.prisma, user.organizationId);
    return withData(res, await this.view(user, res.data, cfg.handover.requiredFields));
  }

  private async load(user: Principal, id: string): Promise<Row> {
    const r = await this.prisma.handoverRecord.findFirst({ where: { AND: [await this.where(user), { id }] } });
    if (!r) throw notFound('Handover');
    return r;
  }

  /** File-scope inheritance: may the caller see (and attach to) this handover? */
  async canAccess(user: Principal, id: string): Promise<boolean> {
    try {
      await this.load(user, id);
      return true;
    } catch {
      return false;
    }
  }

  async get(user: Principal, id: string) {
    const r = await this.load(user, id);
    const { cfg } = await cxConfig(this.prisma, user.organizationId);
    const [v] = await this.view(user, [r], cfg.handover.requiredFields);
    if (this.access.isSummaryOnly(user, 'handover:view')) return v;
    const history = await this.prisma.cxStateLog.findMany({ where: { organizationId: user.organizationId, entityType: 'handover', entityId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const hn = await userNameMap(this.prisma, user.organizationId, history.map((h) => h.actorId));
    return { ...v, history: history.map((h) => ({ from: h.fromStatus, to: h.toStatus, actorName: h.actorId ? hn.get(h.actorId) ?? null : 'System', note: h.note, at: h.createdAt })) };
  }

  private async fieldData(orgId: string, dto: Dto<typeof updateHandoverSchema>): Promise<Prisma.HandoverRecordUncheckedUpdateInput> {
    const { amountPaid, amountDue, ...rest } = dto;
    if (dto.programId) {
      const p = await this.prisma.program.findFirst({ where: { id: dto.programId, organizationId: orgId }, select: { name: true } });
      if (!p) throw notFound('Program');
      if (!dto.programName) rest.programName = p.name;
    }
    return {
      ...rest,
      ...(amountPaid !== undefined ? { amountPaid: new Prisma.Decimal(amountPaid) } : {}),
      ...(amountDue !== undefined ? { amountDue: new Prisma.Decimal(amountDue) } : {}),
      ...(dto.consents ? { consents: { ...dto.consents, confirmedAt: new Date().toISOString() } } : {}),
    };
  }

  /** Manual creation for a WON sale (state machine: deal WON, learner contact, program). Normally created by the deal-won event. */
  async create(user: Principal, dto: Dto<typeof createHandoverSchema>) {
    const org = user.organizationId;
    const deal = dto.dealId ? await this.prisma.deal.findFirst({ where: { id: dto.dealId, organizationId: org } }) : null;
    if (dto.dealId) {
      if (!deal || !(await this.access.canAccessRecord(user, 'deals:view', { organizationId: org, ownerId: deal.ownerId, teamId: deal.teamId }))) throw notFound('Deal');
      if (deal.stage !== 'WON') throw new AppError('DEAL_NOT_WON', 'A handover can only be created for a WON deal', 422);
    }
    const leadId = dto.leadId ?? deal?.leadId;
    const lead = leadId ? await this.prisma.lead.findFirst({ where: { id: leadId, organizationId: org } }) : null;
    if (leadId && (!lead || !(await this.access.canAccessRecord(user, 'leads:view', { organizationId: org, ownerId: lead.assignedToId, teamId: lead.teamId })))) throw notFound('Lead');
    if (!deal && lead && lead.stageCategory !== 'WON') throw new AppError('DEAL_NOT_WON', 'A handover can only be created for a WON sale', 422);
    const ownerId = dto.ownerId ?? deal?.ownerId ?? lead?.assignedToId ?? user.userId;
    await assertOrgUsers(this.prisma, org, [ownerId]);
    if (!(await canActOnUser(this.access, user, 'handover:create', ownerId))) throw notFound('Owner');

    const r = await createHandoverFromTrigger(this.prisma, { id: randomUUID(), eventType: 'manual', organizationId: org, payload: { dealId: dto.dealId, leadId, ownerId } });
    if (!r.created) {
      if (r.reason === 'DUPLICATE' || r.reason === 'ATTACHED_DEAL') throw new AppError('HANDOVER_EXISTS', 'A handover already exists for this sale', 409, { handoverId: r.handoverId });
      throw new AppError('HANDOVER_NOT_CREATED', `Handover could not be created (${r.reason})`, 422);
    }
    const { dealId: _d, leadId: _l, ownerId: _o, ...fields } = dto;
    if (Object.values(fields).some((v) => v !== undefined)) {
      await this.prisma.handoverRecord.update({ where: { id: r.handoverId }, data: await this.fieldData(org, fields) });
    }
    await this.audit.record({ organizationId: org, actorId: user.userId, action: 'handover.created', entityType: 'handover', entityId: r.handoverId, metadata: { manual: true } });
    return this.get(user, r.handoverId);
  }

  async update(user: Principal, id: string, dto: Dto<typeof updateHandoverSchema>) {
    const r = await this.load(user, id);
    if (!(await canActOnUser(this.access, user, 'handover:create', r.ownerId))) throw notFound('Handover');
    if (r.status !== 'DRAFT' && r.status !== 'INFO_REQUESTED') throw new AppError('HANDOVER_LOCKED', 'Only draft or info-requested handovers can be edited', 409);
    const res = await this.prisma.handoverRecord.updateMany({ where: { id, status: r.status, version: r.version }, data: { ...((await this.fieldData(user.organizationId, dto)) as Prisma.HandoverRecordUncheckedUpdateManyInput), version: { increment: 1 } } });
    if (res.count !== 1) throw conflict('CONFLICT', 'The handover was changed by someone else; reload and retry');
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'handover.updated', entityType: 'handover', entityId: id, metadata: { fields: Object.keys(dto) } });
    return this.get(user, id);
  }

  async submit(user: Principal, id: string) {
    const r = await this.load(user, id);
    const rule = findRule(HANDOVER_RULES, r.status, 'SUBMITTED');
    if (!rule) throw illegalTransition(r.status, 'SUBMITTED');
    if (!ruleAllows(rule, { roles: user.roles, isOwner: r.ownerId === user.userId }) || !(await canActOnUser(this.access, user, 'handover:create', r.ownerId))) throw notFound('Handover');
    const { cfg } = await cxConfig(this.prisma, user.organizationId);
    // BLOCKS submission when required checklist fields are missing (422 lists them)
    const missing = missingHandoverFields({ ...r }, cfg.handover.requiredFields);
    if (missing.length) throw new AppError('HANDOVER_INCOMPLETE', `Checklist incomplete: ${missing.join(', ')}`, 422, missing.map((m) => ({ path: m, message: 'required' })));
    const now = new Date();
    const ackDueAt = new Date(now.getTime() + cfg.handover.ackSlaHours * 3_600_000);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.handoverRecord.updateMany({ where: { id, status: r.status, version: r.version }, data: { status: 'SUBMITTED', submittedAt: now, ackDueAt, overdueAt: null, overdueLevel: 0, infoRequest: null, version: { increment: 1 } } });
      if (res.count !== 1) throw conflict('CONFLICT', 'The handover was changed by someone else; reload and retry');
      await logState(tx, { organizationId: user.organizationId, entityType: 'handover', entityId: id, from: r.status, to: 'SUBMITTED', actorId: user.userId });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: rule.audit, entityType: 'handover', entityId: id, metadata: { from: r.status, dealId: r.dealId } });
      await emitCx(tx, {
        organizationId: user.organizationId, eventType: CX_EVENTS.HANDOVER_SUBMITTED, aggregateType: 'handover', aggregateId: id, key: `handover.submitted:${id}:${r.version + 1}`,
        // salesOwnerId (not ownerId): the platform notifier would otherwise also notify the submitter of their own submission
        payload: { organizationId: user.organizationId, handoverId: id, status: 'SUBMITTED', salesOwnerId: r.ownerId, dealId: r.dealId, leadId: r.leadId, actorId: user.userId, notifyRoles: ['STUDENT_SUCCESS'], ackDueAt: ackDueAt.toISOString() },
      });
    });
    return this.get(user, id);
  }

  private async studentSuccessMove(user: Principal, id: string, to: 'ACKNOWLEDGED' | 'INFO_REQUESTED' | 'COMPLETED', input: Record<string, unknown>, apply: (r: Row, now: Date) => Prisma.HandoverRecordUncheckedUpdateManyInput, event: string, notifyUserIds: (r: Row) => string[], note: string | null) {
    const r = await this.load(user, id);
    const rule = findRule(HANDOVER_RULES, r.status, to);
    if (!rule) throw illegalTransition(r.status, to);
    if (!ruleAllows(rule, { roles: user.roles, isOwner: false })) throw new AppError('FORBIDDEN', 'Only the receiving Student Success team can perform this step', 403);
    const miss = missingRequired(rule, input);
    if (miss.length) throw fieldsRequired(miss);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.handoverRecord.updateMany({ where: { id, status: r.status, version: r.version }, data: { ...apply(r, now), status: to, version: { increment: 1 } } });
      if (res.count !== 1) throw conflict('CONFLICT', 'The handover was changed by someone else; reload and retry');
      await logState(tx, { organizationId: user.organizationId, entityType: 'handover', entityId: id, from: r.status, to, actorId: user.userId, note });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: rule.audit, entityType: 'handover', entityId: id, metadata: { from: r.status, to } });
      await emitCx(tx, {
        organizationId: user.organizationId, eventType: event, aggregateType: 'handover', aggregateId: id, key: `${event}:${id}:${r.version + 1}`,
        payload: { organizationId: user.organizationId, handoverId: id, status: to, salesOwnerId: r.ownerId, dealId: r.dealId, leadId: r.leadId, actorId: user.userId, notifyUserIds: notifyUserIds(r) },
      });
      if (to === 'INFO_REQUESTED' && r.leadId) {
        // state machine side effect: a task to the sales owner to answer the questions
        await tx.task.create({ data: { organizationId: user.organizationId, leadId: r.leadId, assignedToId: r.ownerId, createdById: user.userId, type: 'OTHER', title: 'Answer Student Success handover questions', description: note, dueAt: new Date(now.getTime() + 24 * 3_600_000), priority: 'HIGH', ruleKey: 'HANDOVER_INFO_REQUESTED', idempotencyKey: `handover-info:${id}:${r.version + 1}` } });
      }
      if (to === 'COMPLETED') {
        // enrolment-experience survey scheduled (state machine side effect); capture is manual until Phase 8 delivery exists
        await emitCx(tx, { organizationId: user.organizationId, eventType: CX_EVENTS.SURVEY_REQUESTED, aggregateType: 'handover', aggregateId: id, key: `survey.requested:handover:${id}`, payload: { organizationId: user.organizationId, kind: 'ENROLMENT_EXPERIENCE', handoverId: id, leadId: r.leadId } });
      }
    });
    return this.get(user, id);
  }

  acknowledge(user: Principal, id: string, dto: Dto<typeof acknowledgeHandoverSchema>) {
    return (async () => {
      const receiving = dto.receivingOwnerId ?? user.userId;
      await assertOrgUsers(this.prisma, user.organizationId, [receiving]);
      return this.studentSuccessMove(user, id, 'ACKNOWLEDGED', { ...dto }, (_r, now) => ({ acknowledgedAt: now, receivingOwnerId: receiving }), CX_EVENTS.HANDOVER_ACKNOWLEDGED, (r) => [r.ownerId], dto.note ?? null);
    })();
  }

  requestInfo(user: Principal, id: string, dto: Dto<typeof requestHandoverInfoSchema>) {
    return this.studentSuccessMove(user, id, 'INFO_REQUESTED', { ...dto }, (_r, now) => ({ infoRequest: dto.questions, infoRequestedAt: now }), CX_EVENTS.HANDOVER_INFO_REQUESTED, (r) => [r.ownerId], dto.questions);
  }

  complete(user: Principal, id: string, dto: Dto<typeof completeHandoverSchema>) {
    return this.studentSuccessMove(user, id, 'COMPLETED', { note: dto.note }, (_r, now) => ({ completedAt: now, completionNote: dto.note }), CX_EVENTS.HANDOVER_COMPLETED, (r) => [r.ownerId], dto.note);
  }
}
