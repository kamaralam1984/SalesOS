import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { assignLeadTx, createTaskTx, getRule, getWorkingHours, addWorkingMinutes, loadStages, lockLead, pickRoundRobin, resolveExceptions, transitionLeadTx, leadAgeing } from '@salesos/crm-core';
import type { z } from 'zod';
import type { bulkAssignSchema, listQueueQuerySchema, reactivateSchema, resolveExceptionSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { CrmSupport, recordAccess } from '../crm.support';
import { LeadsService } from '../leads/leads.service';

const and = <T extends Record<string, unknown>>(where: Record<string, unknown>, ...extra: T[]) => ({ ...where, AND: [...((where.AND as unknown[] | undefined) ?? []), ...extra] });

@Injectable()
export class QueuesService {
  constructor(
    private readonly s: CrmSupport,
    private readonly leads: LeadsService,
  ) {}

  // ---- exception queue --------------------------------------------------------------------------------------------
  async exceptions(user: Principal, q: z.infer<typeof listQueueQuerySchema>) {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'leads:exceptions:view', ownerField: 'assignedToId', teamField: 'teamId' });
    const leadWhere = { ...scoped, mergedIntoId: null } as Prisma.LeadWhereInput;
    const where: Prisma.LeadExceptionWhereInput = { organizationId: user.organizationId, resolvedAt: q.status === 'RESOLVED' ? { not: null } : null, ...(q.kind ? { kind: q.kind as never } : {}), lead: leadWhere };
    const rows = await this.s.prisma.leadException.findMany({ where, include: { lead: true }, orderBy: [{ detectedAt: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const page = res.data as typeof rows;
    const ser = await this.leads.serializeMany(user, page.map((r) => r.lead));
    const counts = await this.s.prisma.leadException.groupBy({ by: ['kind'], where: { organizationId: user.organizationId, resolvedAt: null, lead: leadWhere }, _count: { _all: true } });
    return ok(
      page.map((r, i) => ({ id: r.id, kind: r.kind, detail: r.detail, detectedAt: r.detectedAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null, lead: ser[i], ageing: leadAgeing(r.lead) })),
      { ...res.meta, counts: Object.fromEntries(counts.map((c) => [c.kind, c._count._all])) },
    );
  }

  async resolveException(user: Principal, id: string, body: z.infer<typeof resolveExceptionSchema>) {
    const ex = await this.s.prisma.leadException.findFirst({ where: { id, organizationId: user.organizationId }, include: { lead: true } });
    await this.s.access.assertRecordAccess(user, 'leads:reassignment-queue:resolve', ex && recordAccess(ex.lead), 'Exception');
    if (ex!.resolvedAt) throw new AppError('INVALID_STATE', 'Exception already resolved', 409);
    if (ex!.kind === 'NO_OWNER' || ex!.kind === 'NO_NEXT_ACTION') throw new AppError('INVALID_STATE', 'This exception clears automatically once the lead has an owner / next action', 409);
    await this.s.tx(async (tx) => {
      await resolveExceptions(tx, ex!.leadId, [ex!.kind]);
      await tx.lead.update({ where: { id: ex!.leadId }, data: { lastActivityAt: new Date() } });
      await this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'exception.resolved', entityType: 'lead', entityId: ex!.leadId, metadata: { kind: ex!.kind, note: body.note } });
    });
    return { id, resolved: true };
  }

  // ---- reassignment queue -----------------------------------------------------------------------------------------
  async reassignmentQueue(user: Principal, q: z.infer<typeof listQueueQuerySchema>) {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'leads:exceptions:view', ownerField: 'previousOwnerId', teamField: 'teamId' });
    const where = { ...scoped, status: q.status } as Prisma.ReassignmentQueueEntryWhereInput;
    const rows = await this.s.prisma.reassignmentQueueEntry.findMany({ where, include: { lead: { select: { id: true, fullName: true, status: true, stageCategory: true, nextActionAt: true } }, task: { select: { id: true, title: true, dueAt: true, type: true, leadId: true } } }, orderBy: q.status === 'OPEN' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ resolvedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const page = res.data as typeof rows;
    const names = await this.s.userNames(page.flatMap((r) => [r.previousOwnerId, r.newOwnerId, r.resolvedById]));
    return ok(
      page.map((r) => ({
        id: r.id,
        reason: r.reason,
        status: r.status,
        previousOwner: r.previousOwnerId ? { id: r.previousOwnerId, name: names.get(r.previousOwnerId) ?? null } : null,
        newOwner: r.newOwnerId ? { id: r.newOwnerId, name: names.get(r.newOwnerId) ?? null } : null,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolutionNote: r.resolutionNote ?? null,
        resolvedBy: r.resolvedById ? { id: r.resolvedById, name: names.get(r.resolvedById) ?? null } : null,
        lead: r.lead ? { id: r.lead.id, fullName: r.lead.fullName, status: r.lead.status, nextActionAt: r.lead.nextActionAt?.toISOString() ?? null } : null,
        task: r.task ? { id: r.task.id, title: r.task.title, type: r.task.type, dueAt: r.task.dueAt.toISOString(), leadId: r.task.leadId } : null,
      })),
      res.meta,
    );
  }

  /** Bulk reassignment (manager action). Per-entry transaction + result so one stale entry never blocks the rest. */
  async bulkAssign(user: Principal, body: z.infer<typeof bulkAssignSchema>) {
    const target = await this.s.assertAssignable(user, 'leads:reassignment-queue:resolve', body.toUserId);
    const results: Array<{ entryId: string; status: 'RESOLVED' | 'SKIPPED'; error?: string }> = [];
    const startedAt = new Date();
    for (const entryId of [...new Set(body.entryIds)]) {
      try {
        const entry = await this.s.prisma.reassignmentQueueEntry.findFirst({ where: { id: entryId, organizationId: user.organizationId }, include: { lead: true, task: true } });
        const rec = entry && (entry.lead ? recordAccess(entry.lead) : { organizationId: entry.organizationId, ownerId: entry.previousOwnerId, teamId: entry.teamId });
        await this.s.access.assertRecordAccess(user, 'leads:reassignment-queue:resolve', rec, 'Queue entry');
        if (entry!.status !== 'OPEN') {
          // a task entry resolved a moment ago because its lead moved to the same new owner in this very call
          const movedWithLead = entry!.status === 'RESOLVED' && entry!.newOwnerId === target.id && entry!.resolvedById === user.userId && !!entry!.resolvedAt && entry!.resolvedAt >= startedAt;
          results.push(movedWithLead ? { entryId, status: 'RESOLVED' } : { entryId, status: 'SKIPPED', error: `Entry is ${entry!.status}` });
          continue;
        }
        await this.s.tx(async (tx) => {
          if (entry!.leadId && entry!.lead) {
            const lead = await lockLead(tx, user.organizationId, entry!.leadId);
            if (lead.stageCategory === 'WON') throw new AppError('INVALID_STATE', 'Lead is won', 409);
            if (lead.assignedToId !== target.id) await assignLeadTx(tx, this.s.deps, { lead, toUserId: target.id, actorId: user.userId, method: 'REASSIGNMENT_QUEUE', reason: body.reason });
          }
          if (entry!.taskId) {
            await tx.task.updateMany({ where: { id: entry!.taskId, status: 'OPEN' }, data: { assignedToId: target.id, overdueLevel: 0, remindedAt: null, version: { increment: 1 } } });
            await this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'ownership.changed', entityType: 'task', entityId: entry!.taskId, metadata: { toUserId: target.id, reason: body.reason, via: 'reassignment_queue' } });
          }
          await tx.reassignmentQueueEntry.updateMany({ where: { id: entryId, status: 'OPEN' }, data: { status: 'RESOLVED', openKey: null, resolvedAt: new Date(), resolvedById: user.userId, newOwnerId: target.id, resolutionNote: body.reason } });
        });
        results.push({ entryId, status: 'RESOLVED' });
      } catch (e) {
        if (e instanceof AppError && e.getStatus() === 404) results.push({ entryId, status: 'SKIPPED', error: 'Not found' });
        else if (e instanceof AppError) results.push({ entryId, status: 'SKIPPED', error: e.message });
        else throw e;
      }
    }
    return { toUserId: target.id, resolved: results.filter((r) => r.status === 'RESOLVED').length, skipped: results.filter((r) => r.status === 'SKIPPED').length, results };
  }

  // ---- reactivation -----------------------------------------------------------------------------------------------
  async reactivationQueue(user: Principal, q: { limit?: number; cursor?: string; page?: number; eligibleOnly?: boolean }) {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'leads:reactivation:view', ownerField: 'assignedToId', teamField: 'teamId' });
    const now = new Date();
    const where: Prisma.ReactivationEntryWhereInput = { organizationId: user.organizationId, openKey: { not: null }, lead: { ...scoped, mergedIntoId: null } as Prisma.LeadWhereInput, ...(q.eligibleOnly ? { eligibleFrom: { lte: now } } : {}) };
    const rows = await this.s.prisma.reactivationEntry.findMany({ where, include: { lead: true }, orderBy: [{ eligibleFrom: 'asc' }, { id: 'asc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const page = res.data as typeof rows;
    const ser = await this.leads.serializeMany(user, page.map((r) => r.lead));
    return ok(page.map((r, i) => ({ id: r.id, status: r.status, eligible: r.eligibleFrom <= now, eligibleFrom: r.eligibleFrom.toISOString(), attempts: r.attempts, lostReason: r.lostReason, lead: ser[i] })), res.meta);
  }

  async reactivate(user: Principal, id: string, body: z.infer<typeof reactivateSchema>) {
    const entry = await this.s.prisma.reactivationEntry.findFirst({ where: { id, organizationId: user.organizationId }, include: { lead: true } });
    await this.s.access.assertRecordAccess(user, 'leads:assign', entry && recordAccess(entry.lead), 'Reactivation entry');
    if (!entry!.openKey) throw new AppError('INVALID_STATE', 'The reactivation entry is closed', 409);
    if (entry!.eligibleFrom > new Date()) throw new AppError('NOT_YET_ELIGIBLE', `Eligible from ${entry!.eligibleFrom.toISOString()}`, 409);
    const target = body.toUserId ? await this.s.assertAssignable(user, 'leads:assign', body.toUserId) : null;
    const lead = await this.s.tx(async (tx) => {
      const l = await lockLead(tx, user.organizationId, entry!.leadId);
      if (l.consentStatus === 'WITHDRAWN' || l.consentStatus === 'DND') throw new AppError('CONSENT_BLOCKED', 'Consent withdrawn or do-not-disturb: the lead cannot be reactivated', 409);
      if (l.stageCategory !== 'LOST' && l.stageCategory !== 'NURTURE') throw new AppError('INVALID_STATE', 'Lead is not lost', 409);
      const stages = await loadStages(tx, user.organizationId);
      let toUserId = target?.id ?? null;
      if (!toUserId && l.teamId) toUserId = await pickRoundRobin(tx, user.organizationId, l.teamId, { sourceId: l.sourceId, programId: l.programId });
      if (!toUserId) throw new AppError('NO_ELIGIBLE_USER', 'Choose an owner: round-robin is not enabled or no executive is available', 422);
      const reopened = await transitionLeadTx(tx, this.s.deps, { lead: l, stages, toKey: 'CONTACT_ATTEMPTED', actorId: user.userId, source: 'MANUAL', reason: body.reason });
      await tx.lead.update({ where: { id: l.id }, data: { reactivationCount: { increment: 1 } } });
      const owned = await assignLeadTx(tx, this.s.deps, { lead: { ...reopened, reactivationCount: reopened.reactivationCount + 1 }, toUserId, actorId: user.userId, method: 'REACTIVATION', reason: body.reason });
      const rule = await getRule(tx, user.organizationId, owned.teamId, 'REACTIVATION');
      const wh = await getWorkingHours(tx, user.organizationId, owned.teamId);
      await createTaskTx(tx, this.s.deps, { organizationId: user.organizationId, leadId: owned.id, assignedToId: toUserId, createdById: user.userId, teamId: owned.teamId, type: 'CALL', title: `Re-engage: ${owned.fullName}`, dueAt: addWorkingMinutes(new Date(), rule.taskDueWorkingMinutes, wh), priority: 'HIGH', ruleKey: 'REACTIVATION', idempotencyKey: `reactivation:${entry!.id}` });
      await tx.reactivationEntry.updateMany({ where: { id: entry!.id }, data: { status: 'REACTIVATED', openKey: null, resolvedAt: new Date(), outcome: 'REACTIVATED', assignedToId: toUserId, attempts: { increment: 1 } } });
      return tx.lead.findUniqueOrThrow({ where: { id: l.id } });
    });
    const [ser] = await this.leads.serializeMany(user, [lead]);
    return ser;
  }
}

export { notFound, and };
