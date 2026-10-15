import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { learnerRankFor, resolveCxConfig } from '@salesos/cx-core';
import type { createRelationshipNoteSchema, listWatchlistQuerySchema, setLearnerEarningsSchema, watchProspectSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { ApiResult } from '../../../common/http/api-result';
import { notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { userNameMap } from '../common/support';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

export interface TimelineEntry {
  at: Date;
  type: 'LEAD_CREATED' | 'STATUS_CHANGE' | 'CALL' | 'LEAD_NOTE' | 'RELATIONSHIP_NOTE' | 'COMPLAINT' | 'ESCALATION' | 'SATISFACTION' | 'HANDOVER' | 'EVENT';
  title: string;
  detail?: string | null;
  actorName?: string | null;
  ref?: { type: string; id: string };
}

const cut = (s: string | null | undefined, n = 280) => (s ? (s.length > n ? `${s.slice(0, n)}...` : s) : null);
const PER_SOURCE = 50;

@Injectable()
export class RelationshipsService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  private async loadLead(user: Principal, leadId: string, key: 'relationships:view' | 'relationships:update') {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId: user.organizationId, mergedIntoId: null } });
    if (!lead || !(await this.access.canAccessRecord(user, key, { organizationId: lead.organizationId, ownerId: lead.assignedToId, teamId: lead.teamId }))) throw notFound('Learner');
    return lead;
  }

  /**
   * Relationship history for one learner/prospect: aggregates CRM lead timeline, calls, notes (read through the caller's scope)
   * plus CX complaints / escalations / satisfaction / handover. Summary-scope roles (Student Success) get a minimum-data
   * projection: no contact details, notes, calls, deals or complaints text.
   */
  async history(user: Principal, leadId: string) {
    const lead = await this.loadLead(user, leadId, 'relationships:view');
    const org = user.organizationId;
    const program = lead.programId ? await this.prisma.program.findFirst({ where: { id: lead.programId, organizationId: org }, select: { name: true } }) : null;
    const watch = await this.prisma.keyProspectWatch.findFirst({ where: { organizationId: org, leadId, userId: user.userId }, select: { id: true } });
    const cfg = resolveCxConfig((await this.prisma.cxSetting.findUnique({ where: { organizationId: org }, select: { config: true } }))?.config);
    const rank = learnerRankFor(lead.learnerEarnedRevenue?.toString() ?? null, cfg.learnerRanks);
    const base = {
      id: lead.id, fullName: lead.fullName, status: lead.status, stageCategory: lead.stageCategory, programName: program?.name ?? null,
      preferredLanguage: lead.preferredLanguage, isKeyProspect: lead.isKeyProspect, watching: !!watch,
      // rank label is shown to every viewer (no money); the earned amount only in the full view below
      learnerRank: rank ? { key: rank.key, label: rank.label } : null,
    };
    if (this.access.isSummaryOnly(user, 'relationships:view')) {
      const handover = await this.prisma.handoverRecord.findFirst({ where: { organizationId: org, leadId }, select: { id: true, status: true }, orderBy: { createdAt: 'desc' } });
      return { mode: 'summary' as const, lead: base, handover, timeline: [] as TimelineEntry[], notice: 'Minimum-data view: full relationship history is not shared with your group.' };
    }

    const [statusRows, calls, leadNotes, relNotes, complaints, escalations, satisfaction, handovers, attendances, openTasks] = await Promise.all([
      this.prisma.leadStatusHistory.findMany({ where: { organizationId: org, leadId }, orderBy: { createdAt: 'desc' }, take: PER_SOURCE }),
      this.prisma.callLog.findMany({ where: { organizationId: org, leadId }, orderBy: { startedAt: 'desc' }, take: PER_SOURCE }),
      this.prisma.leadNote.findMany({ where: { organizationId: org, leadId, OR: [{ visibility: 'SHARED' }, { authorId: user.userId }] }, orderBy: { createdAt: 'desc' }, take: PER_SOURCE }),
      this.prisma.relationshipNote.findMany({ where: { organizationId: org, leadId }, orderBy: { createdAt: 'desc' }, take: PER_SOURCE }),
      this.prisma.complaint.findMany({ where: { organizationId: org, leadId }, orderBy: { createdAt: 'desc' }, take: PER_SOURCE }),
      this.prisma.relationshipEscalation.findMany({ where: { organizationId: org, leadId }, orderBy: { createdAt: 'desc' }, take: PER_SOURCE }),
      this.prisma.satisfactionResponse.findMany({ where: { organizationId: org, leadId }, orderBy: { respondedAt: 'desc' }, take: PER_SOURCE }),
      this.prisma.handoverRecord.findMany({ where: { organizationId: org, leadId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.eventAttendance.findMany({ where: { organizationId: org, leadId }, orderBy: { createdAt: 'desc' }, take: PER_SOURCE, include: { event: { select: { title: true, type: true } } } }),
      this.prisma.task.count({ where: { organizationId: org, leadId, status: 'OPEN' } }),
    ]);
    const names = await userNameMap(this.prisma, org, [
      ...statusRows.map((r) => r.changedById), ...calls.map((r) => r.userId), ...leadNotes.map((r) => r.authorId), ...relNotes.map((r) => r.authorId), lead.assignedToId,
    ]);
    const t: TimelineEntry[] = [
      { at: lead.createdAt, type: 'LEAD_CREATED', title: 'Lead created', ref: { type: 'lead', id: lead.id } },
      ...statusRows.map((r): TimelineEntry => ({ at: r.createdAt, type: 'STATUS_CHANGE', title: `Stage: ${r.oldStatus ?? 'new'} to ${r.newStatus}`, detail: cut(r.reason), actorName: r.changedById ? names.get(r.changedById) ?? null : 'System' })),
      ...calls.map((r): TimelineEntry => ({ at: r.startedAt, type: 'CALL', title: `${r.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} call: ${r.outcome}`, detail: cut(r.notes), actorName: names.get(r.userId) ?? null, ref: { type: 'call', id: r.id } })),
      ...leadNotes.map((r): TimelineEntry => ({ at: r.createdAt, type: 'LEAD_NOTE', title: 'Note', detail: cut(r.body), actorName: names.get(r.authorId) ?? null })),
      ...relNotes.map((r): TimelineEntry => ({ at: r.createdAt, type: 'RELATIONSHIP_NOTE', title: r.kind === 'NOTE' ? 'Relationship note' : `Relationship ${r.kind.toLowerCase()}`, detail: cut(r.body), actorName: names.get(r.authorId) ?? null, ref: { type: 'relationship_note', id: r.id } })),
      ...complaints.map((r): TimelineEntry => ({ at: r.createdAt, type: 'COMPLAINT', title: `Complaint ${r.priority}: ${r.title}`, detail: `Status ${r.status}`, ref: { type: 'complaint', id: r.id } })),
      ...escalations.map((r): TimelineEntry => ({ at: r.createdAt, type: 'ESCALATION', title: `Escalation (${r.type === 'HIGH_VALUE' ? 'high value' : 'complex conversation'}): ${r.title}`, detail: `Status ${r.status}`, ref: { type: 'escalation', id: r.id } })),
      ...satisfaction.map((r): TimelineEntry => ({ at: r.respondedAt, type: 'SATISFACTION', title: `${r.kind === 'NPS' ? 'NPS' : r.kind === 'CSAT' ? 'CSAT' : 'Enrolment experience'} score ${r.score}`, detail: cut(r.comment), ref: { type: 'satisfaction', id: r.id } })),
      ...handovers.map((r): TimelineEntry => ({ at: r.createdAt, type: 'HANDOVER', title: `Student Success handover: ${r.status}`, ref: { type: 'handover', id: r.id } })),
      ...attendances.map((r): TimelineEntry => ({ at: r.createdAt, type: 'EVENT', title: `${r.event.type === 'DEMO' ? 'Demo' : 'Webinar/event'}: ${r.event.title} (${r.status})`, ref: { type: 'event', id: r.eventId } })),
    ];
    t.sort((a, b) => b.at.getTime() - a.at.getTime());
    return {
      mode: 'full' as const,
      lead: { ...base, learnerEarnedRevenue: lead.learnerEarnedRevenue?.toString() ?? null, learnerEarnedAt: lead.learnerEarnedAt, nextRank: rank?.next ?? null, ladder: cfg.learnerRanks, ownerName: lead.assignedToId ? names.get(lead.assignedToId) ?? null : null, email: lead.email, phone: lead.phoneE164 ?? lead.phoneRaw, nextActionAt: lead.nextActionAt, lastActivityAt: lead.lastActivityAt, estimatedValue: lead.estimatedValue?.toString() ?? null, currency: lead.currency },
      counts: { calls: calls.length, openComplaints: complaints.filter((c) => !['RESOLVED', 'CLOSED'].includes(c.status)).length, openEscalations: escalations.filter((e) => ['OPEN', 'IN_REVIEW'].includes(e.status)).length, openTasks },
      deals: lead.wonAt ? { available: true, summary: { wonAt: lead.wonAt, wonValue: lead.wonValue?.toString() ?? null, currency: lead.currency }, note: 'Deal detail lives in Revenue.' } : { available: true, summary: null, note: 'No won deal on this lead.' },
      timeline: t.slice(0, 200),
    };
  }

  /** Record the learner's reported coaching earnings; the rank (JD value statement) is derived from the configurable ladder. */
  async setLearnerEarnings(user: Principal, leadId: string, dto: Dto<typeof setLearnerEarningsSchema>) {
    const lead = await this.loadLead(user, leadId, 'relationships:update');
    const cfg = resolveCxConfig((await this.prisma.cxSetting.findUnique({ where: { organizationId: user.organizationId }, select: { config: true } }))?.config);
    const before = learnerRankFor(lead.learnerEarnedRevenue?.toString() ?? null, cfg.learnerRanks);
    const after = learnerRankFor(dto.earnedRevenue, cfg.learnerRanks)!;
    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: leadId }, data: { learnerEarnedRevenue: dto.earnedRevenue, learnerEarnedAt: new Date() } });
      if (dto.note) await tx.relationshipNote.create({ data: { organizationId: user.organizationId, leadId, authorId: user.userId, kind: 'MILESTONE', body: dto.note } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'relationship.learner_earnings_set', entityType: 'lead', entityId: leadId, metadata: { rankBefore: before?.key ?? null, rankAfter: after.key } });
    });
    return { leadId, earnedRevenue: dto.earnedRevenue, rank: { key: after.key, label: after.label }, nextRank: after.next, rankChanged: before?.key !== after.key };
  }

  async addNote(user: Principal, leadId: string, dto: Dto<typeof createRelationshipNoteSchema>) {
    await this.loadLead(user, leadId, 'relationships:update');
    const note = await this.prisma.$transaction(async (tx) => {
      const n = await tx.relationshipNote.create({ data: { organizationId: user.organizationId, leadId, authorId: user.userId, kind: dto.kind, body: dto.body } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'relationship.note_added', entityType: 'lead', entityId: leadId, metadata: { noteId: n.id, kind: dto.kind } });
      return n;
    });
    return { id: note.id, leadId, kind: note.kind, body: note.body, createdAt: note.createdAt, authorId: note.authorId };
  }

  // ------------------------------------------------------------------ key-prospect watchlist
  async watchlist(user: Principal, q: Dto<typeof listWatchlistQuerySchema>) {
    // leads I can see under relationships:view AND (I watch them OR CRM flags them as key prospects)
    const scoped = (await this.access.scopedWhere(user, { permission: 'relationships:view', ownerField: 'assignedToId', teamField: 'teamId' })) as Prisma.LeadWhereInput;
    const watched = await this.prisma.keyProspectWatch.findMany({ where: { organizationId: user.organizationId, userId: user.userId }, select: { leadId: true, reason: true } });
    const reasons = new Map(watched.map((w) => [w.leadId, w.reason]));
    const rows = await this.prisma.lead.findMany({
      where: { AND: [scoped, { mergedIntoId: null }, { OR: [{ isKeyProspect: true }, { id: { in: [...reasons.keys()] } }] }] },
      select: { id: true, fullName: true, status: true, stageCategory: true, isKeyProspect: true, nextActionAt: true, lastActivityAt: true, assignedToId: true, estimatedValue: true, currency: true, programId: true },
      orderBy: [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.map((r) => r.assignedToId));
    const now = Date.now();
    return new ApiResult(
      res.data.map((r) => ({
        id: r.id, fullName: r.fullName, status: r.status, stageCategory: r.stageCategory, isKeyProspect: r.isKeyProspect, watching: reasons.has(r.id), watchReason: reasons.get(r.id) ?? null,
        ownerName: r.assignedToId ? names.get(r.assignedToId) ?? null : null, nextActionAt: r.nextActionAt, lastActivityAt: r.lastActivityAt,
        // honest signal: no activity for > 3 working-ish days (72h) on a key prospect
        stale: r.stageCategory === 'OPEN' && (!r.lastActivityAt || now - r.lastActivityAt.getTime() > 72 * 3_600_000),
        estimatedValue: r.estimatedValue?.toString() ?? null, currency: r.currency,
      })),
      res.meta,
    );
  }

  async watch(user: Principal, dto: Dto<typeof watchProspectSchema>) {
    await this.loadLead(user, dto.leadId, 'relationships:update');
    const w = await this.prisma.keyProspectWatch.upsert({
      where: { organizationId_leadId_userId: { organizationId: user.organizationId, leadId: dto.leadId, userId: user.userId } },
      create: { organizationId: user.organizationId, leadId: dto.leadId, userId: user.userId, reason: dto.reason ?? null },
      update: { reason: dto.reason ?? null },
    });
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'relationship.watch_added', entityType: 'lead', entityId: dto.leadId });
    return { id: w.id, leadId: w.leadId, reason: w.reason };
  }

  async unwatch(user: Principal, leadId: string) {
    const res = await this.prisma.keyProspectWatch.deleteMany({ where: { organizationId: user.organizationId, leadId, userId: user.userId } });
    if (res.count === 0) throw notFound('Watchlist entry');
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'relationship.watch_removed', entityType: 'lead', entityId: leadId });
    return { removed: true };
  }
}
