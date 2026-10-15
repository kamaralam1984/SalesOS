import { Injectable } from '@nestjs/common';
import { Prisma, type Lead } from '@prisma/client';
import { CRM_EVENTS } from '@salesos/shared-types';
import { lockLead, normalizeEmail, normalizePhone, syncLeadExceptions, syncLeadNextAction } from '@salesos/crm-core';
import type { z } from 'zod';
import type { dismissDuplicateSchema, mergeDuplicateSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { CrmSupport, recordAccess } from '../crm.support';
import { LeadsService } from './leads.service';

@Injectable()
export class DuplicatesService {
  constructor(
    private readonly s: CrmSupport,
    private readonly leads: LeadsService,
  ) {}

  async list(user: Principal, q: { limit?: number; cursor?: string; page?: number; status?: 'OPEN' | 'MERGED' | 'DISMISSED' }) {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'leads:duplicates:review', ownerField: 'assignedToId', teamField: 'teamId' });
    const where: Prisma.DuplicateCandidateWhereInput = { organizationId: user.organizationId, status: q.status ?? 'OPEN', lead: { ...scoped, mergedIntoId: null } as Prisma.LeadWhereInput, otherLead: { ...scoped, mergedIntoId: null } as Prisma.LeadWhereInput };
    const rows = await this.s.prisma.duplicateCandidate.findMany({ where, include: { lead: true, otherLead: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const page = res.data as typeof rows;
    const all = page.flatMap((r) => [r.lead, r.otherLead]);
    const ser = await this.leads.serializeMany(user, all);
    const by = new Map(ser.map((l) => [(l as { id: string }).id, l]));
    return ok(page.map((r) => ({ id: r.id, matchType: r.matchType, status: r.status, createdAt: r.createdAt.toISOString(), leadA: by.get(r.leadId), leadB: by.get(r.otherLeadId) })), res.meta);
  }

  private async loadCandidate(user: Principal, id: string) {
    const c = await this.s.prisma.duplicateCandidate.findFirst({ where: { id, organizationId: user.organizationId }, include: { lead: true, otherLead: true } });
    if (!c) throw notFound('Duplicate candidate');
    await this.s.access.assertRecordAccess(user, 'leads:duplicates:review', recordAccess(c.lead), 'Duplicate candidate');
    await this.s.access.assertRecordAccess(user, 'leads:duplicates:review', recordAccess(c.otherLead), 'Duplicate candidate');
    return c;
  }

  async dismiss(user: Principal, id: string, body: z.infer<typeof dismissDuplicateSchema>) {
    const c = await this.loadCandidate(user, id);
    if (c.status !== 'OPEN') throw new AppError('INVALID_STATE', `Candidate is already ${c.status}`, 409);
    await this.s.tx(async (tx) => {
      const res = await tx.duplicateCandidate.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'DISMISSED', reviewedById: user.userId, reviewedAt: new Date() } });
      if (res.count === 0) throw new AppError('INVALID_STATE', 'Candidate is no longer open', 409);
      await this.refreshFlags(tx, [c.leadId, c.otherLeadId]);
      await this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'duplicate.dismissed', entityType: 'duplicate_candidate', entityId: id, metadata: { leadId: c.leadId, otherLeadId: c.otherLeadId, reason: body.reason } });
    });
    return { id, status: 'DISMISSED' };
  }

  private async refreshFlags(tx: Prisma.TransactionClient, ids: string[]) {
    for (const lid of ids) {
      const open = await tx.duplicateCandidate.count({ where: { status: 'OPEN', OR: [{ leadId: lid }, { otherLeadId: lid }] } });
      await tx.lead.updateMany({ where: { id: lid }, data: { duplicateFlag: open > 0 } });
    }
  }

  /** Merge keeps the winner, moves history/calls/tasks/notes, preserves the loser row + a full audit snapshot (DEC-011). */
  async merge(user: Principal, id: string, body: z.infer<typeof mergeDuplicateSchema>) {
    const c = await this.loadCandidate(user, id);
    if (c.status !== 'OPEN') throw new AppError('INVALID_STATE', `Candidate is already ${c.status}`, 409);
    if (body.winnerLeadId !== c.leadId && body.winnerLeadId !== c.otherLeadId) throw new AppError('VALIDATION_ERROR', 'winnerLeadId must be one of the two leads', 422);
    const loserId = body.winnerLeadId === c.leadId ? c.otherLeadId : c.leadId;
    const winnerId = body.winnerLeadId;
    const merged = await this.s.tx(async (tx) => {
      // deterministic lock order avoids deadlocks between concurrent merges
      const [first, second] = [winnerId, loserId].sort();
      await lockLead(tx, user.organizationId, first!);
      await lockLead(tx, user.organizationId, second!);
      const winner = await tx.lead.findUniqueOrThrow({ where: { id: winnerId } });
      const loser = await tx.lead.findUniqueOrThrow({ where: { id: loserId } });
      if (winner.mergedIntoId || loser.mergedIntoId) throw new AppError('INVALID_STATE', 'One of the leads was already merged', 409);
      if (winner.stageCategory === 'WON' && loser.stageCategory === 'WON') throw new AppError('INVALID_STATE', 'Two won leads cannot be merged', 409);
      const fresh = await tx.duplicateCandidate.findFirst({ where: { id, status: 'OPEN' } });
      if (!fresh) throw new AppError('INVALID_STATE', 'Candidate is no longer open', 409);

      const data: Prisma.LeadUncheckedUpdateInput = { version: { increment: 1 } };
      const take = new Set(body.takeFromLoser);
      if (take.has('fullName')) data.fullName = loser.fullName;
      if (take.has('email') && loser.email) {
        data.email = loser.email;
        data.emailNormalized = normalizeEmail(loser.email);
      }
      if (take.has('phone') && (loser.phoneE164 || loser.phoneRaw)) {
        data.phoneE164 = loser.phoneE164;
        data.phoneRaw = loser.phoneRaw;
        data.phoneValid = loser.phoneValid;
      }
      if (take.has('programId')) data.programId = loser.programId;
      if (take.has('sourceId')) data.sourceId = loser.sourceId;
      if (take.has('interestLevel')) data.interestLevel = loser.interestLevel;
      if (take.has('estimatedValue')) data.estimatedValue = loser.estimatedValue;
      if (take.has('preferredLanguage')) data.preferredLanguage = loser.preferredLanguage;
      // privacy-safe: the more restrictive consent wins
      const rank = { GRANTED: 1, UNKNOWN: 0, WITHDRAWN: 2, DND: 3 } as const;
      if (rank[loser.consentStatus] > rank[winner.consentStatus]) {
        data.consentStatus = loser.consentStatus;
        data.consentAt = loser.consentAt;
        data.consentSource = loser.consentSource;
      }
      data.callAttemptCount = winner.callAttemptCount + loser.callAttemptCount;
      data.isKeyProspect = winner.isKeyProspect || loser.isKeyProspect;
      const acts = [winner.lastActivityAt, loser.lastActivityAt].filter((x): x is Date => !!x);
      if (acts.length) data.lastActivityAt = new Date(Math.max(...acts.map((a) => a.getTime())));
      const contacts: Array<{ kind: 'PHONE' | 'EMAIL'; value: string }> = [];
      const phoneLoser = loser.phoneE164 ?? loser.phoneRaw;
      if (phoneLoser && phoneLoser !== (winner.phoneE164 ?? winner.phoneRaw) && !take.has('phone')) contacts.push({ kind: 'PHONE', value: phoneLoser });
      if (loser.email && loser.emailNormalized !== winner.emailNormalized && !take.has('email')) contacts.push({ kind: 'EMAIL', value: loser.email });
      if (contacts.length) await tx.leadContact.createMany({ data: contacts.map((x) => ({ organizationId: user.organizationId, leadId: winnerId, kind: x.kind, value: x.value, label: 'From merged duplicate' })), skipDuplicates: true });

      const moved = {
        calls: (await tx.callLog.updateMany({ where: { leadId: loserId }, data: { leadId: winnerId } })).count,
        notes: (await tx.leadNote.updateMany({ where: { leadId: loserId }, data: { leadId: winnerId } })).count,
        history: (await tx.leadStatusHistory.updateMany({ where: { leadId: loserId }, data: { leadId: winnerId } })).count,
        assignments: (await tx.leadAssignment.updateMany({ where: { leadId: loserId }, data: { leadId: winnerId } })).count,
        tasks: 0,
        attendance: 0,
      };
      const ownerId = winner.assignedToId;
      moved.tasks = (await tx.task.updateMany({ where: { leadId: loserId }, data: { leadId: winnerId, ...(ownerId ? {} : {}) } })).count;
      if (ownerId) await tx.task.updateMany({ where: { leadId: winnerId, status: 'OPEN', assignedToId: { not: ownerId }, createdById: null }, data: { assignedToId: ownerId } });
      const winnerEvents = new Set((await tx.eventAttendance.findMany({ where: { leadId: winnerId }, select: { eventId: true } })).map((a) => a.eventId));
      for (const a of await tx.eventAttendance.findMany({ where: { leadId: loserId } })) {
        if (winnerEvents.has(a.eventId)) await tx.eventAttendance.delete({ where: { id: a.id } });
        else {
          await tx.eventAttendance.update({ where: { id: a.id }, data: { leadId: winnerId } });
          moved.attendance++;
        }
      }
      await tx.leadException.updateMany({ where: { leadId: loserId, resolvedAt: null }, data: { resolvedAt: new Date(), openKey: null } });
      await tx.reassignmentQueueEntry.updateMany({ where: { leadId: loserId, status: 'OPEN' }, data: { status: 'CANCELLED', openKey: null, resolvedAt: new Date(), resolutionNote: 'Lead merged' } });
      await tx.reactivationEntry.updateMany({ where: { leadId: loserId, openKey: { not: null } }, data: { status: 'ARCHIVED', openKey: null, resolvedAt: new Date(), outcome: 'MERGED' } });
      // other candidates of the loser now point at the winner (or are closed if they would self-pair)
      for (const other of await tx.duplicateCandidate.findMany({ where: { id: { not: id }, status: 'OPEN', OR: [{ leadId: loserId }, { otherLeadId: loserId }] } })) {
        const partner = other.leadId === loserId ? other.otherLeadId : other.leadId;
        await tx.duplicateCandidate.delete({ where: { id: other.id } });
        if (partner !== winnerId) {
          const [a, b] = winnerId < partner ? [winnerId, partner] : [partner, winnerId];
          await tx.duplicateCandidate.createMany({ data: [{ organizationId: user.organizationId, leadId: a, otherLeadId: b, matchType: other.matchType }], skipDuplicates: true });
        }
      }
      await tx.lead.update({ where: { id: loserId }, data: { mergedIntoId: winnerId, duplicateFlag: false, nextActionAt: null, nextActionType: null } });
      const after = await tx.lead.update({ where: { id: winnerId }, data });
      await tx.duplicateCandidate.update({ where: { id }, data: { status: 'MERGED', reviewedById: user.userId, reviewedAt: new Date() } });
      await tx.leadMerge.create({ data: { organizationId: user.organizationId, winnerId, loserId, candidateId: id, mergedById: user.userId, snapshotBefore: JSON.parse(JSON.stringify({ winner, loser })) as Prisma.InputJsonValue, snapshotAfter: JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue, moved } });
      await this.refreshFlags(tx, [winnerId]);
      await syncLeadNextAction(tx, winnerId);
      await syncLeadExceptions(tx, winnerId);
      await syncLeadExceptions(tx, loserId);
      await this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'lead.merged', entityType: 'lead', entityId: winnerId, metadata: { loserId, candidateId: id, reason: body.reason, takeFromLoser: body.takeFromLoser, moved, before: { winner: pick(winner), loser: pick(loser) } } });
      await this.s.deps.publish(tx, { eventType: CRM_EVENTS.LEAD_MERGED, aggregateType: 'lead', aggregateId: winnerId, organizationId: user.organizationId, payload: { winnerId, loserId, candidateId: id }, idempotencyKey: `lead.merged:${loserId}` });
      return after;
    });
    const [lead] = await this.leads.serializeMany(user, [merged]);
    return { winner: lead, loserId, candidateId: id, status: 'MERGED' };
  }
}

/** audit metadata carries no contact PII; the full before/after snapshot lives in lead_merges (access controlled) */
const pick = (l: Lead) => ({ id: l.id, status: l.status, assignedToId: l.assignedToId, programId: l.programId, sourceId: l.sourceId });
void normalizePhone;
