import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type CallLog, type Lead, type TaskType } from '@prisma/client';
import { CRM_EVENTS } from '@salesos/shared-types';
import {
  addWorkingDays,
  addWorkingMinutes,
  createTaskTx,
  findForwardPath,
  getRule,
  getWorkingHours,
  loadStages,
  lockLead,
  raiseException,
  resolveExceptions,
  startOfLocalDay,
  syncLeadExceptions,
  syncLeadNextAction,
  transitionLeadTx,
  type Tx,
} from '@salesos/crm-core';
import type { z } from 'zod';
import type { logCallSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { CRM_FAULT_INJECTOR, CrmSupport, taskAccess, type FaultInjector } from '../crm.support';
import { LeadsService } from '../leads/leads.service';

type Body = z.infer<typeof logCallSchema>;

const ATTEMPT_OUTCOMES = new Set(['NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'FAILED', 'CALLBACK']);

@Injectable()
export class CallsService {
  constructor(
    private readonly s: CrmSupport,
    private readonly leads: LeadsService,
    @Inject(CRM_FAULT_INJECTOR) private readonly fault: FaultInjector,
  ) {}

  async list(user: Principal, leadId: string, q: { limit?: number; cursor?: string; page?: number }) {
    await this.leads.loadLead(user, leadId, 'calls:view');
    const rows = await this.s.prisma.callLog.findMany({ where: { leadId, organizationId: user.organizationId }, include: { notesRows: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await this.s.userNames((res.data as CallLog[]).map((c) => c.userId));
    return ok(
      (res.data as Array<CallLog & { notesRows: { id: string; summary: string | null; objections: string | null; nextSteps: string | null }[] }>).map((c) => ({
        id: c.id,
        leadId: c.leadId,
        userId: c.userId,
        userName: names.get(c.userId) ?? null,
        source: c.source,
        sourceLabel: c.source === 'MANUAL' ? 'MANUAL (typed by the executive)' : c.source,
        direction: c.direction,
        outcome: c.outcome,
        startedAt: c.startedAt.toISOString(),
        durationSeconds: c.durationSeconds,
        interestLevel: c.interestLevel,
        objectionCategory: c.objectionCategory,
        notes: c.notes,
        nextActionAt: c.nextActionAt?.toISOString() ?? null,
        nextActionType: c.nextActionType,
        taskId: c.taskId,
        createdAt: c.createdAt.toISOString(),
        callNotes: c.notesRows.map((n) => ({ id: n.id, summary: n.summary, objections: n.objections, nextSteps: n.nextSteps })),
      })),
      res.meta,
    );
  }

  /**
   * Disposition flow: call log + call note + (completed task) + automation task(s) + status history + lead counters,
   * ALL in one transaction. Any failure rolls everything back. Calls are always source=MANUAL (never invented).
   */
  async log(user: Principal, leadId: string, body: Body, idemKey?: string) {
    await this.leads.loadLead(user, leadId, 'calls:create');
    if (body.taskId) {
      const t = await this.s.prisma.task.findFirst({ where: { id: body.taskId, organizationId: user.organizationId } });
      await this.s.access.assertRecordAccess(user, 'tasks:update', t && taskAccess(t), 'Task');
      if (t!.leadId !== leadId) throw new AppError('VALIDATION_ERROR', 'The task does not belong to this lead', 422);
    }
    const key = idemKey ? `${user.userId}:${idemKey}`.slice(0, 200) : null;
    try {
      return await this.s.tx(async (tx) => this.logTx(tx, user, leadId, body, key));
    } catch (e) {
      if (key && (e as { code?: string }).code === 'P2002') {
        const ex = await this.s.prisma.callLog.findFirst({ where: { organizationId: user.organizationId, idempotencyKey: key } });
        if (ex) return ok({ call: serializeCall(ex), lead: null, tasksCreated: [], statusChanges: [] }, { idempotentReplay: true });
      }
      throw e;
    }
  }

  private async logTx(tx: Tx, user: Principal, leadId: string, body: Body, key: string | null) {
    const org = user.organizationId;
    const lead0 = await lockLead(tx, org, leadId);
    if (key) {
      const ex = await tx.callLog.findFirst({ where: { organizationId: org, idempotencyKey: key } });
      if (ex) return ok({ call: serializeCall(ex), lead: null, tasksCreated: [], statusChanges: [] }, { warnings: [], idempotentReplay: true });
    }
    const now = new Date();
    const warnings: string[] = [];
    const teamId = lead0.teamId;
    const wh = await getWorkingHours(tx, org, teamId);
    const stages = await loadStages(tx, org);
    const isOpen = lead0.stageCategory === 'OPEN';
    if (!isOpen && (body.outcome === 'WON' || body.outcome === 'LOST')) {
      throw new AppError('INVALID_TRANSITION', `Cannot record ${body.outcome} on a lead that is ${lead0.stageCategory}`, 409);
    }

    const call = await tx.callLog.create({
      data: {
        organizationId: org,
        leadId,
        userId: user.userId,
        source: 'MANUAL',
        direction: body.direction,
        outcome: body.outcome,
        startedAt: body.startedAt ?? now,
        durationSeconds: body.durationSeconds ?? null,
        notes: body.notes ?? null,
        interestLevel: body.interestLevel ?? null,
        objectionCategory: body.objectionCategory ?? null,
        nextActionAt: body.nextActionAt ?? body.callbackAt ?? null,
        nextActionType: body.nextActionType ?? (body.outcome === 'CALLBACK' ? 'CALLBACK' : null),
        taskId: body.taskId ?? null,
        idempotencyKey: key,
      },
    });
    if (body.notes || body.objectionCategory || body.nextActionAt) {
      await tx.callNote.create({
        data: { organizationId: org, callId: call.id, authorId: user.userId, summary: body.notes ?? null, objections: body.objectionCategory ?? null, nextSteps: body.nextActionAt ? `${body.nextActionType ?? 'FOLLOW_UP'} at ${body.nextActionAt.toISOString()}` : null },
      });
    }
    await this.fault('after_call_insert');

    // complete the task this call was made from
    if (body.taskId) {
      const done = await tx.task.updateMany({
        where: { id: body.taskId, status: 'OPEN' },
        data: { status: 'DONE', completedAt: now, completedById: user.userId, completionNote: `Call logged: ${body.outcome}`, version: { increment: 1 } },
      });
      if (done.count === 0) warnings.push('The linked task was already closed');
    }

    // ---- counters ----------------------------------------------------------------------------------------------
    const counters: Prisma.LeadUncheckedUpdateInput = {
      lastActivityAt: now,
      lastContactAt: now,
      firstContactAt: lead0.firstContactAt ?? now,
      callAttemptCount: { increment: 1 },
      version: { increment: 1 },
    };
    if (body.interestLevel) counters.interestLevel = body.interestLevel;
    if (body.outcome === 'NO_ANSWER') counters.noAnswerCount = { increment: 1 };
    if (body.outcome === 'SWITCHED_OFF') counters.consecutiveSwitchedOff = { increment: 1 };
    else counters.consecutiveSwitchedOff = 0;
    if (body.outcome === 'CONNECTED' || body.outcome === 'WON') counters.noAnswerCount = 0;
    await tx.lead.update({ where: { id: leadId }, data: counters });
    let lead: Lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });

    // ---- status transitions -------------------------------------------------------------------------------------
    const statusChanges: Array<{ from: string; to: string }> = [];
    const hop = async (toKey: string, extra: { lostReason?: string | null; lostNote?: string | null; wonValue?: string | number | null; wonAt?: Date | null } = {}) => {
      const before = lead.status;
      lead = await transitionLeadTx(tx, this.s.deps, { lead, stages, toKey, actorId: user.userId, source: 'CALL', callLogId: call.id, reason: `Call outcome ${body.outcome}`, system: true, ...extra });
      statusChanges.push({ from: before, to: toKey });
    };
    if (isOpen) {
      const sortOf = (k: string) => stages.find((x) => x.key === k)?.sortOrder ?? 0;
      if (ATTEMPT_OUTCOMES.has(body.outcome) && lead.status === 'NEW') await hop('CONTACT_ATTEMPTED');
      if (body.outcome === 'CONNECTED' && sortOf(lead.status) < sortOf('CONNECTED')) {
        for (const k of findForwardPath(stages, lead.status, 'CONNECTED') ?? []) await hop(k);
        if (lead.status !== 'CONNECTED') throw new AppError('INVALID_TRANSITION', `Cannot move the lead from ${lead.status} to CONNECTED`, 409);
      }
      if (body.outcome === 'WON') {
        const wonKey = stages.find((x) => x.category === 'WON')?.key ?? 'WON';
        const path = findForwardPath(stages, lead.status, wonKey);
        if (!path) throw new AppError('INVALID_TRANSITION', `Cannot mark a lead in ${lead.status} as won`, 409);
        for (const k of path.slice(0, -1)) await hop(k);
        await hop(wonKey, { wonValue: body.wonValue, wonAt: body.wonAt });
      }
      if (body.outcome === 'LOST') {
        const lostKey = stages.find((x) => x.category === 'LOST')?.key ?? 'LOST';
        await hop(lostKey, { lostReason: body.lostReason, lostNote: body.lostNote });
      }
    }
    await this.fault('after_status_change');

    // ---- automation per outcome (DEC-026, configurable org < team) ---------------------------------------------------
    const tasksCreated: Array<{ id: string; type: string; dueAt: string; title: string }> = [];
    const mk = async (input: { type: TaskType; title: string; dueAt: Date; assignedToId?: string; priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; isPinned?: boolean; ruleKey: string; suffix: string }) => {
      const { task } = await createTaskTx(tx, this.s.deps, {
        organizationId: org,
        leadId,
        assignedToId: input.assignedToId ?? lead.assignedToId ?? user.userId,
        createdById: user.userId,
        teamId: lead.teamId,
        type: input.type,
        title: input.title,
        dueAt: input.dueAt,
        priority: input.priority,
        isPinned: input.isPinned,
        ruleKey: input.ruleKey,
        idempotencyKey: `call:${call.id}:${input.suffix}`,
      });
      tasksCreated.push({ id: task.id, type: task.type, dueAt: task.dueAt.toISOString(), title: task.title });
      return task;
    };
    const explicit = body.nextActionAt ?? null;
    const name = lead.fullName;
    const stillOpen = lead.stageCategory === 'OPEN';
    const managerId = stillOpen ? await this.s.managerOf(org, lead.assignedToId ?? user.userId, tx) : null;
    const flagReview = async (detail: string) => {
      await raiseException(tx, this.s.deps, lead, 'MANAGER_REVIEW', detail);
      if (managerId) {
        await mk({ type: 'MANAGER_REVIEW', title: `Review lead: ${name} (${detail})`, dueAt: addWorkingMinutes(now, 60, wh), assignedToId: managerId, priority: 'HIGH', ruleKey: 'MANAGER_REVIEW', suffix: 'review' });
      }
    };
    if (stillOpen) {
      switch (body.outcome) {
        case 'NO_ANSWER': {
          const r = await getRule(tx, org, teamId, 'NO_ANSWER');
          const total = lead.noAnswerCount;
          const today = await tx.callLog.count({ where: { leadId, outcome: 'NO_ANSWER', startedAt: { gte: startOfLocalDay(now, wh.timezone) } } });
          if (total >= r.maxAttemptsTotal) {
            await flagReview(`${total} no-answer attempts`);
            if (explicit) await mk({ type: body.nextActionType ?? 'CALL', title: `Call back ${name}`, dueAt: explicit, ruleKey: 'NO_ANSWER_RETRY', suffix: 'retry' });
            warnings.push('Maximum no-answer attempts reached: sent to manager review (the lead is NOT marked lost)');
          } else {
            const due = explicit ?? (today >= r.maxAttemptsPerDay ? addWorkingDays(now, 1, wh) : addWorkingMinutes(now, r.retryDelayWorkingMinutes, wh));
            await mk({ type: 'CALL', title: `Retry call: ${name} (no answer)`, dueAt: due, ruleKey: 'NO_ANSWER_RETRY', suffix: 'retry' });
          }
          break;
        }
        case 'BUSY': {
          const r = await getRule(tx, org, teamId, 'BUSY');
          const requested = body.callbackAt ?? explicit;
          const due = requested ?? addWorkingMinutes(now, r.defaultDelayWorkingMinutes, wh);
          if (requested && !isWithin(requested, wh)) warnings.push('The requested callback time is outside working hours; it was honoured as requested');
          await mk({ type: 'CALLBACK', title: `Callback: ${name} (was busy)`, dueAt: due, priority: requested ? 'HIGH' : 'NORMAL', ruleKey: 'BUSY_CALLBACK', suffix: 'callback' });
          break;
        }
        case 'SWITCHED_OFF': {
          const r = await getRule(tx, org, teamId, 'SWITCHED_OFF');
          await mk({ type: 'CALL', title: `Retry call: ${name} (phone switched off)`, dueAt: explicit ?? addWorkingDays(now, r.retryDelayWorkingDays, wh), ruleKey: 'SWITCHED_OFF_RETRY', suffix: 'retry' });
          if (lead.consecutiveSwitchedOff >= r.consecutiveForManagerReview) {
            await flagReview(`${lead.consecutiveSwitchedOff} consecutive switched-off calls`);
            warnings.push('Repeated switched-off calls: sent to manager review');
          }
          break;
        }
        case 'CALLBACK': {
          await mk({ type: 'CALLBACK', title: `Callback requested: ${name}`, dueAt: body.callbackAt!, priority: 'HIGH', isPinned: true, ruleKey: 'CALLBACK', suffix: 'callback' });
          break;
        }
        case 'FAILED': {
          const r = await getRule(tx, org, teamId, 'FAILED');
          if (explicit || r.createRetryTask) await mk({ type: 'CALL', title: `Retry call: ${name} (call failed)`, dueAt: explicit ?? addWorkingMinutes(now, r.retryDelayWorkingMinutes, wh), ruleKey: 'FAILED_RETRY', suffix: 'retry' });
          break;
        }
        case 'CONNECTED': {
          const type = (body.nextActionType && body.nextActionType !== 'CALLBACK' ? body.nextActionType : 'FOLLOW_UP') as TaskType;
          await mk({ type, title: `Follow up: ${name}`, dueAt: explicit!, ruleKey: 'CONNECTED_NEXT_ACTION', suffix: 'next' });
          await resolveExceptions(tx, leadId, ['MANAGER_REVIEW']);
          break;
        }
        default:
          break;
      }
    } else if (body.outcome === 'WON') {
      const r = await getRule(tx, org, teamId, 'WON');
      await mk({ type: 'ONBOARDING', title: `Onboarding / handover: ${name}`, dueAt: addWorkingMinutes(now, r.onboardingDueWorkingMinutes, wh), priority: 'HIGH', ruleKey: 'WON_ONBOARDING', suffix: 'onboarding' });
      await this.fault('after_task_insert');
    }
    if (stillOpen) await this.fault('after_task_insert');

    // a follow-up chosen in the form for outcomes that did not create one above
    if (stillOpen && explicit && !tasksCreated.length && body.outcome !== 'LOST' && body.outcome !== 'WON') {
      await mk({ type: body.nextActionType ?? 'FOLLOW_UP', title: `Follow up: ${name}`, dueAt: explicit, ruleKey: 'DISPOSITION_NEXT_ACTION', suffix: 'next' });
    }

    await syncLeadNextAction(tx, leadId);
    await syncLeadExceptions(tx, leadId);
    await this.s.deps.audit(tx, { organizationId: org, actorId: user.userId, action: 'call.created', entityType: 'call', entityId: call.id, metadata: { leadId, outcome: body.outcome, source: 'MANUAL', statusChanges, tasks: tasksCreated.map((t) => t.id) } });
    await this.s.deps.publish(tx, {
      eventType: CRM_EVENTS.CALL_LOGGED,
      aggregateType: 'call',
      aggregateId: call.id,
      organizationId: org,
      payload: { callId: call.id, leadId, userId: user.userId, outcome: body.outcome },
      idempotencyKey: `call.logged:${call.id}`,
    });
    const finalLead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    return ok({ call: serializeCall(call), lead: { id: finalLead.id, status: finalLead.status, stageCategory: finalLead.stageCategory, nextActionAt: finalLead.nextActionAt?.toISOString() ?? null, nextActionType: finalLead.nextActionType, version: finalLead.version }, tasksCreated, statusChanges }, { warnings });
  }
}

function isWithin(d: Date, wh: Awaited<ReturnType<typeof getWorkingHours>>): boolean {
  return addWorkingMinutes(d, 0, wh).getTime() === d.getTime();
}

function serializeCall(c: CallLog) {
  return { id: c.id, leadId: c.leadId, userId: c.userId, source: c.source, direction: c.direction, outcome: c.outcome, startedAt: c.startedAt.toISOString(), durationSeconds: c.durationSeconds, interestLevel: c.interestLevel, objectionCategory: c.objectionCategory, notes: c.notes, nextActionAt: c.nextActionAt?.toISOString() ?? null, taskId: c.taskId, createdAt: c.createdAt.toISOString() };
}

export { notFound };
