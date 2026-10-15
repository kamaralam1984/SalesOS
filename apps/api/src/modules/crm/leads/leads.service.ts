import { Injectable } from '@nestjs/common';
import { Prisma, type Lead } from '@prisma/client';
import { AGEING_BUCKETS, leadAgeing, toCsv, createLeadTx, assignLeadTx, detectDuplicates, getWorkingHours, loadStages, lockLead, normalizeEmail, normalizePhone, pickRoundRobin, resolveTeamId, syncLeadExceptions, transitionLeadTx, type Tx } from '@salesos/crm-core';
import type { z } from 'zod';
import type { assignLeadSchema, changeStatusSchema, createLeadSchema, createNoteSchema, listLeadsQuerySchema, timelineQuerySchema, updateLeadSchema } from '@salesos/validation';
import type { Principal } from '../../../common/authz';
import { AppError, forbidden, notFound } from '../../../common/http/errors';
import { ok } from '../../../common/http/api-result';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { CrmSupport, recordAccess } from '../crm.support';
import { emptyLookups, serializeLead, serializeLeadSummary, type LeadLookups } from './lead.serializer';

type ListQuery = z.infer<typeof listLeadsQuerySchema>;

const and = (where: Record<string, unknown>, ...extra: Prisma.LeadWhereInput[]): Prisma.LeadWhereInput => {
  const existing = (where.AND as Prisma.LeadWhereInput[] | undefined) ?? [];
  return { ...where, AND: [...existing, ...extra] } as Prisma.LeadWhereInput;
};

@Injectable()
export class LeadsService {
  constructor(private readonly s: CrmSupport) {}

  private get prisma() {
    return this.s.prisma;
  }

  /** Load one lead the caller may see (IDOR-safe 404 for missing or out-of-scope), under the given permission. */
  async loadLead(user: Principal, id: string, permission: Parameters<CrmSupport['access']['assertRecordAccess']>[1]): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({ where: { id, organizationId: user.organizationId, mergedIntoId: null } });
    await this.s.access.assertRecordAccess(user, permission, lead && recordAccess(lead), 'Lead');
    return lead!;
  }

  /** Batch lookups used by list/detail/workspace serialisation. */
  async lookups(user: Principal, leads: Lead[]): Promise<LeadLookups> {
    const lk = emptyLookups();
    if (!leads.length) return lk;
    const ids = leads.map((l) => l.id);
    const [users, sources, programs, calls, atts, exc] = await Promise.all([
      this.s.userNames(leads.map((l) => l.assignedToId)),
      this.prisma.leadSource.findMany({ where: { organizationId: user.organizationId, id: { in: leads.flatMap((l) => (l.sourceId ? [l.sourceId] : [])) } }, select: { id: true, name: true } }),
      this.prisma.program.findMany({ where: { organizationId: user.organizationId, id: { in: leads.flatMap((l) => (l.programId ? [l.programId] : [])) } }, select: { id: true, name: true, code: true } }),
      this.prisma.$queryRaw<{ lead_id: string; outcome: string; objection_category: string | null; interest_level: string | null; created_at: Date; source: string }[]>`
        SELECT DISTINCT ON (lead_id) lead_id::text, outcome::text, objection_category::text, interest_level::text, created_at, source::text
        FROM call_logs WHERE lead_id = ANY(${ids}::uuid[]) ORDER BY lead_id, created_at DESC`,
      this.prisma.$queryRaw<{ lead_id: string; event_id: string; title: string; type: string; status: string; starts_at: Date }[]>`
        SELECT DISTINCT ON (a.lead_id) a.lead_id::text, e.id::text AS event_id, e.title, e.type::text, a.status::text, e.starts_at
        FROM event_attendance a JOIN events e ON e.id = a.event_id WHERE a.lead_id = ANY(${ids}::uuid[]) ORDER BY a.lead_id, e.starts_at DESC`,
      this.prisma.leadException.findMany({ where: { leadId: { in: ids }, resolvedAt: null }, select: { leadId: true, kind: true } }),
    ]);
    lk.users = users;
    lk.sources = new Map(sources.map((x) => [x.id, x.name]));
    lk.programs = new Map(programs.map((x) => [x.id, { name: x.name, code: x.code }]));
    for (const c of calls) lk.lastCalls.set(c.lead_id, { outcome: c.outcome, objectionCategory: c.objection_category, interestLevel: c.interest_level, at: c.created_at, source: c.source });
    for (const a of atts) lk.attendance.set(a.lead_id, { eventId: a.event_id, title: a.title, type: a.type, status: a.status, startsAt: a.starts_at });
    for (const e of exc) lk.exceptions.set(e.leadId, [...(lk.exceptions.get(e.leadId) ?? []), e.kind]);
    return lk;
  }

  async serializeMany(user: Principal, leads: Lead[]) {
    const lk = await this.lookups(user, leads);
    const now = new Date();
    return this.s.access.isSummaryOnly(user, 'leads:view') ? leads.map((l) => serializeLeadSummary(l, lk)) : leads.map((l) => serializeLead(l, lk, now));
  }

  // ---- list ------------------------------------------------------------------------------------------------------
  private async buildListQuery(user: Principal, q: ListQuery, permission: 'leads:view' | 'leads:export' = 'leads:view') {
    const scoped = await this.s.access.scopedWhere(user, { permission, ownerField: 'assignedToId', teamField: 'teamId' });
    const now = new Date();
    const extra: Prisma.LeadWhereInput[] = [{ mergedIntoId: null }];
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      const or: Prisma.LeadWhereInput[] = [{ fullName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }];
      if (digits.length >= 3) or.push({ phoneE164: { contains: digits } }, { phoneRaw: { contains: digits } });
      extra.push({ OR: or });
    }
    if (q.status) extra.push({ status: { in: q.status.split(',').map((x) => x.trim()).filter(Boolean) } });
    if (q.category) extra.push({ stageCategory: q.category });
    if (q.assignedToId === 'unassigned') extra.push({ assignedToId: null });
    else if (q.assignedToId) extra.push({ assignedToId: q.assignedToId });
    if (q.mine) extra.push({ assignedToId: user.userId });
    if (q.teamId) extra.push({ teamId: q.teamId });
    if (q.sourceId) extra.push({ sourceId: q.sourceId });
    if (q.programId) extra.push({ programId: q.programId });
    if (q.interestLevel) extra.push({ interestLevel: q.interestLevel });
    if (q.consentStatus) extra.push({ consentStatus: q.consentStatus });
    if (q.duplicate !== undefined) extra.push({ duplicateFlag: q.duplicate });
    if (q.keyProspect !== undefined) extra.push({ isKeyProspect: q.keyProspect });
    if (q.overdue) extra.push({ stageCategory: 'OPEN', nextActionAt: { lt: now } });
    if (q.createdFrom) extra.push({ createdAt: { gte: q.createdFrom } });
    if (q.createdTo) extra.push({ createdAt: { lte: q.createdTo } });
    if (q.noActivityDays) {
      const cutoff = new Date(now.getTime() - q.noActivityDays * 86_400_000);
      extra.push({ stageCategory: 'OPEN', OR: [{ lastActivityAt: { lt: cutoff } }, { lastActivityAt: null, createdAt: { lt: cutoff } }] });
    }
    const where = and(scoped, ...extra);
    const dir = q.dir;
    const orderBy: Prisma.LeadOrderByWithRelationInput[] =
      q.sort === 'priority'
        ? [{ isKeyProspect: 'desc' }, { interestLevel: { sort: 'desc', nulls: 'last' } }, { nextActionAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
        : q.sort === 'nextActionAt'
          ? [{ nextActionAt: { sort: dir, nulls: 'last' } }, { id: dir }]
          : q.sort === 'lastActivityAt'
            ? [{ lastActivityAt: { sort: dir, nulls: 'last' } }, { id: dir }]
            : [{ createdAt: dir }, { id: dir }];
    return { where, orderBy };
  }

  async list(user: Principal, q: ListQuery) {
    const { where, orderBy } = await this.buildListQuery(user, q);
    const rows = await this.prisma.lead.findMany({ where, orderBy, ...pageArgs(q) });
    const total = q.page ? await this.prisma.lead.count({ where }) : undefined;
    const res = pageResult(rows, q, total);
    const page = res.data as Lead[];
    return ok(await this.serializeMany(user, page), res.meta);
  }

  /** CSV export of the filtered, scoped list (leads:export, audited). Capped at 10 000 rows; formula-injection safe. */
  async exportCsv(user: Principal, q: ListQuery): Promise<{ csv: string; rows: number; truncated: boolean }> {
    const { where, orderBy } = await this.buildListQuery(user, q, 'leads:export');
    const MAX = 10_000;
    const rows = await this.prisma.lead.findMany({ where, orderBy, take: MAX + 1 });
    const truncated = rows.length > MAX;
    const page = rows.slice(0, MAX);
    const names = await this.s.userNames(page.map((l) => l.assignedToId));
    const [sources, programs] = await Promise.all([this.prisma.leadSource.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true } }), this.prisma.program.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true } })]);
    const sm = new Map(sources.map((x) => [x.id, x.name]));
    const pm = new Map(programs.map((x) => [x.id, x.name]));
    const csv = toCsv([
      ['id', 'name', 'phone', 'email', 'status', 'stage_category', 'interest', 'owner', 'source', 'program', 'next_action_at', 'last_activity_at', 'consent', 'created_at'],
      ...page.map((l) => [l.id, l.fullName, l.phoneE164 ?? l.phoneRaw, l.email, l.status, l.stageCategory, l.interestLevel, l.assignedToId ? names.get(l.assignedToId) : null, l.sourceId ? sm.get(l.sourceId) : null, l.programId ? pm.get(l.programId) : null, l.nextActionAt?.toISOString(), l.lastActivityAt?.toISOString(), l.consentStatus, l.createdAt.toISOString()]),
    ]);
    await this.prisma.$transaction((tx) => this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'export.created', entityType: 'lead', metadata: { kind: 'leads', rows: page.length, truncated, filters: Object.keys(q).filter((k) => !['limit', 'cursor', 'page', 'sort', 'dir'].includes(k)) } }));
    return { csv, rows: page.length, truncated };
  }

  /** Lead ageing histogram for the caller's scope: OPEN leads bucketed by age since creation and since last activity. */
  async ageing(user: Principal) {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'leads:view', ownerField: 'assignedToId', teamField: 'teamId' });
    const rows = await this.prisma.lead.findMany({ where: and(scoped, { mergedIntoId: null, stageCategory: 'OPEN' }), select: { createdAt: true, lastActivityAt: true }, take: 50_000 });
    const now = new Date();
    const zero = () => Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<string, number>;
    const sinceCreation = zero();
    const sinceActivity = zero();
    for (const r of rows) {
      const a = leadAgeing(r, now);
      sinceCreation[a.creationBucket]!++;
      sinceActivity[a.activityBucket]!++;
    }
    return { total: rows.length, buckets: AGEING_BUCKETS, sinceCreation, sinceLastActivity: sinceActivity, definition: 'Open leads; "since last activity" falls back to creation when untouched' };
  }

  // ---- detail ----------------------------------------------------------------------------------------------------
  async get(user: Principal, id: string) {
    const lead = await this.loadLead(user, id, 'leads:view');
    if (this.s.access.isSummaryOnly(user, 'leads:view')) return (await this.serializeMany(user, [lead]))[0];
    const [base] = await this.serializeMany(user, [lead]);
    const [contacts, calls, tasks, attendances, assignments, dupCount, history] = await Promise.all([
      this.prisma.leadContact.findMany({ where: { leadId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.callLog.findMany({ where: { leadId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5 }),
      this.prisma.task.findMany({ where: { leadId: id, status: 'OPEN' }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: 20 }),
      this.prisma.eventAttendance.findMany({ where: { leadId: id }, include: { event: { select: { id: true, title: true, type: true, startsAt: true, status: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.leadAssignment.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.duplicateCandidate.count({ where: { organizationId: user.organizationId, status: 'OPEN', OR: [{ leadId: id }, { otherLeadId: id }] } }),
      this.prisma.leadStatusHistory.findMany({ where: { leadId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const names = await this.s.userNames([...calls.map((c) => c.userId), ...assignments.flatMap((a) => [a.fromUserId, a.toUserId, a.changedById]), ...tasks.map((t) => t.assignedToId)]);
    const stages = await this.prisma.leadStageConfig.findMany({ where: { organizationId: user.organizationId, isActive: true }, orderBy: { sortOrder: 'asc' } });
    return {
      ...base,
      contacts: contacts.map((c) => ({ id: c.id, kind: c.kind, value: c.value, label: c.label, isPrimary: c.isPrimary })),
      recentCalls: calls.map((c) => ({ id: c.id, outcome: c.outcome, source: c.source, direction: c.direction, startedAt: c.startedAt.toISOString(), durationSeconds: c.durationSeconds, interestLevel: c.interestLevel, objectionCategory: c.objectionCategory, notes: c.notes, userId: c.userId, userName: names.get(c.userId) ?? null })),
      openTasks: tasks.map((t) => ({ id: t.id, type: t.type, title: t.title, dueAt: t.dueAt.toISOString(), priority: t.priority, isPinned: t.isPinned, version: t.version, description: t.description, assignedToId: t.assignedToId, assignedToName: names.get(t.assignedToId) ?? null, overdue: t.dueAt < new Date() })),
      attendances: attendances.map((a) => ({ id: a.id, status: a.status, event: { id: a.event.id, title: a.event.title, type: a.event.type, startsAt: a.event.startsAt.toISOString(), status: a.event.status }, joinedAt: a.joinedAt?.toISOString() ?? null })),
      assignments: assignments.map((a) => ({ id: a.id, from: a.fromUserId ? { id: a.fromUserId, name: names.get(a.fromUserId) ?? null } : null, to: a.toUserId ? { id: a.toUserId, name: names.get(a.toUserId) ?? null } : null, changedBy: a.changedById ? { id: a.changedById, name: names.get(a.changedById) ?? null } : null, method: a.method, reason: a.reason, at: a.createdAt.toISOString() })),
      statusHistory: history.map((h) => ({ id: h.id, from: h.oldStatus, to: h.newStatus, reason: h.reason, source: h.source, at: h.createdAt.toISOString() })),
      openDuplicateCount: dupCount,
      stages: stages.map((s) => ({ key: s.key, label: s.label, category: s.category, sortOrder: s.sortOrder })),
    };
  }

  // ---- create ----------------------------------------------------------------------------------------------------
  async create(user: Principal, body: z.infer<typeof createLeadSchema>, idemKey?: string) {
    const canAssign = this.s.access.has(user, 'leads:assign');
    let assignedToId = body.assignedToId ?? null;
    const autoAssign = body.autoAssign;
    if (!canAssign) {
      // executives own what they create
      if (assignedToId && assignedToId !== user.userId) throw forbidden('You can only create leads assigned to yourself');
      if (autoAssign === 'round_robin') throw forbidden('Round-robin assignment requires the assign permission');
      assignedToId = user.userId;
    } else if (assignedToId) {
      await this.s.assertAssignable(user, 'leads:assign', assignedToId);
    }
    const teamId = await resolveTeamId(this.prisma as unknown as Tx, user.organizationId, user.userId);
    const createKey = idemKey ? `${user.userId}:${idemKey}`.slice(0, 200) : null;
    const result = await this.s.tx(async (tx) =>
      createLeadTx(tx, this.s.deps, { userId: user.userId, organizationId: user.organizationId, teamId }, {
        fullName: body.fullName,
        phone: body.phone,
        email: body.email,
        sourceId: body.sourceId,
        campaignId: body.campaignId,
        programId: body.programId,
        assignedToId,
        interestLevel: body.interestLevel,
        estimatedValue: body.estimatedValue,
        preferredLanguage: body.preferredLanguage,
        consentStatus: body.consentStatus,
        consentSource: body.consentSource,
        isKeyProspect: body.isKeyProspect,
        note: body.note,
        autoAssign,
        createKey,
      }),
    ).catch(async (e) => {
      if (createKey && e instanceof AppError === false && (e as { code?: string }).code === 'P2002') {
        const ex = await this.prisma.lead.findFirst({ where: { organizationId: user.organizationId, createKey } });
        if (ex) return { lead: ex, created: false, duplicateLeadIds: [] as string[], warnings: [] as string[] };
      }
      throw e;
    });
    const [lead] = await this.serializeMany(user, [result.lead]);
    const dups = result.duplicateLeadIds.length
      ? await this.prisma.lead.findMany({ where: { id: { in: result.duplicateLeadIds }, organizationId: user.organizationId }, select: { id: true, fullName: true } })
      : [];
    return ok({ lead, created: result.created, possibleDuplicates: dups }, { warnings: result.warnings });
  }

  // ---- update ----------------------------------------------------------------------------------------------------
  async update(user: Principal, id: string, body: z.infer<typeof updateLeadSchema>) {
    const existing = await this.loadLead(user, id, 'leads:update');
    const changed: string[] = [];
    const updated = await this.s.tx(async (tx) => {
      const lead = await lockLead(tx, user.organizationId, id);
      if (body.version && body.version !== lead.version) throw new AppError('VERSION_CONFLICT', 'The lead was changed by someone else; reload and retry', 409);
      const data: Prisma.LeadUncheckedUpdateInput = { version: { increment: 1 } };
      const set = <K extends keyof Prisma.LeadUncheckedUpdateInput>(k: K, v: Prisma.LeadUncheckedUpdateInput[K], differs: boolean) => {
        if (differs) {
          data[k] = v;
          changed.push(k as string);
        }
      };
      if (body.fullName !== undefined) set('fullName', body.fullName, body.fullName !== lead.fullName);
      let phoneChanged = false;
      if (body.phone !== undefined) {
        const p = normalizePhone(body.phone);
        if ((p.e164 ?? p.raw) !== (lead.phoneE164 ?? lead.phoneRaw ?? '')) {
          if (!p.raw && !(body.email ?? lead.email)) throw new AppError('VALIDATION_ERROR', 'A phone number or an email is required', 422);
          data.phoneE164 = p.e164;
          data.phoneRaw = p.raw || null;
          data.phoneValid = p.raw ? p.valid : true;
          changed.push('phone');
          phoneChanged = true;
        }
      }
      let emailChanged = false;
      if (body.email !== undefined) {
        const e = normalizeEmail(body.email);
        if (e !== lead.emailNormalized) {
          if (!e && !(data.phoneRaw ?? lead.phoneRaw)) throw new AppError('VALIDATION_ERROR', 'A phone number or an email is required', 422);
          data.email = body.email?.trim() || null;
          data.emailNormalized = e;
          changed.push('email');
          emailChanged = true;
        }
      }
      for (const [field, ref, check] of [['sourceId', 'leadSource', body.sourceId], ['campaignId', 'leadCampaign', body.campaignId], ['programId', 'program', body.programId]] as const) {
        if (check === undefined) continue;
        if (check) {
          const found = await (tx[ref] as unknown as { findFirst(a: unknown): Promise<unknown> }).findFirst({ where: { id: check, organizationId: user.organizationId } });
          if (!found) throw new AppError('VALIDATION_ERROR', `Unknown ${field}`, 422);
        }
        set(field, check, check !== lead[field]);
      }
      if (body.interestLevel !== undefined) set('interestLevel', body.interestLevel, body.interestLevel !== lead.interestLevel);
      if (body.estimatedValue !== undefined) set('estimatedValue', body.estimatedValue === null ? null : new Prisma.Decimal(body.estimatedValue), String(body.estimatedValue ?? '') !== String(lead.estimatedValue ?? ''));
      if (body.preferredLanguage !== undefined) set('preferredLanguage', body.preferredLanguage ?? null, (body.preferredLanguage ?? null) !== lead.preferredLanguage);
      if (body.isKeyProspect !== undefined) set('isKeyProspect', body.isKeyProspect, body.isKeyProspect !== lead.isKeyProspect);
      let consentChanged = false;
      if (body.consentStatus !== undefined && body.consentStatus !== lead.consentStatus) {
        data.consentStatus = body.consentStatus;
        data.consentAt = new Date();
        data.consentSource = body.consentSource ?? `user:${user.userId}`;
        changed.push('consentStatus');
        consentChanged = true;
      }
      if (!changed.length) return lead;
      const next = await tx.lead.update({ where: { id }, data });
      if (phoneChanged || emailChanged || data.fullName) await detectDuplicates(tx, next);
      if (consentChanged && (body.consentStatus === 'WITHDRAWN' || body.consentStatus === 'DND')) {
        await tx.reactivationEntry.updateMany({ where: { leadId: id, openKey: { not: null } }, data: { status: 'EXCLUDED', openKey: null, resolvedAt: new Date(), outcome: 'CONSENT_WITHDRAWN' } });
      }
      await this.s.deps.audit(tx, { organizationId: user.organizationId, actorId: user.userId, action: consentChanged ? 'lead.consent_changed' : 'lead.updated', entityType: 'lead', entityId: id, metadata: { fields: changed, consentStatus: consentChanged ? body.consentStatus : undefined } });
      return next;
    });
    void existing;
    const [lead] = await this.serializeMany(user, [updated]);
    return lead;
  }

  // ---- assign ----------------------------------------------------------------------------------------------------
  async assign(user: Principal, id: string, body: z.infer<typeof assignLeadSchema>) {
    await this.loadLead(user, id, 'leads:assign');
    const target = body.mode === 'user' && body.toUserId ? await this.s.assertAssignable(user, 'leads:assign', body.toUserId) : null;
    const updated = await this.s.tx(async (tx) => {
      const lead = await lockLead(tx, user.organizationId, id);
      if (lead.stageCategory === 'WON') throw new AppError('INVALID_TRANSITION', 'A won lead cannot be reassigned', 409);
      let toUserId = target?.id ?? null;
      let method: 'MANUAL' | 'ROUND_ROBIN' = 'MANUAL';
      if (body.mode === 'round_robin') {
        if (!lead.teamId) throw new AppError('NO_TEAM', 'The lead has no team; round-robin needs a team', 422);
        toUserId = await pickRoundRobin(tx, user.organizationId, lead.teamId, { sourceId: lead.sourceId, programId: lead.programId });
        if (!toUserId) throw new AppError('NO_ELIGIBLE_USER', 'Round-robin is not enabled for the team or no eligible executive is available', 422);
        method = 'ROUND_ROBIN';
      }
      if (toUserId === lead.assignedToId) throw new AppError('NO_CHANGE', 'The lead is already assigned to that user', 422);
      return assignLeadTx(tx, this.s.deps, { lead, toUserId, actorId: user.userId, method, reason: body.reason });
    });
    const [lead] = await this.serializeMany(user, [updated]);
    return lead;
  }

  // ---- status ----------------------------------------------------------------------------------------------------
  async changeStatus(user: Principal, id: string, body: z.infer<typeof changeStatusSchema>) {
    const existing = await this.loadLead(user, id, 'leads:status:change');
    const updated = await this.s.tx(async (tx) => {
      const lead = await lockLead(tx, user.organizationId, id);
      if (body.version && body.version !== lead.version) throw new AppError('VERSION_CONFLICT', 'The lead was changed by someone else; reload and retry', 409);
      const stages = await loadStages(tx, user.organizationId);
      const to = stages.find((s) => s.key === body.status);
      if (to?.category === 'OPEN' && (lead.stageCategory === 'LOST' || lead.stageCategory === 'NURTURE') && !this.s.access.has(user, 'leads:assign')) {
        throw forbidden('Only a manager or team lead can reopen a lost lead');
      }
      if (to?.category === 'WON' && (body.wonValue === undefined || body.wonValue === null || Number(body.wonValue) <= 0)) {
        throw new AppError('WON_VALUE_REQUIRED', 'A positive won value is required to mark a lead as won', 422);
      }
      return transitionLeadTx(tx, this.s.deps, {
        lead,
        stages,
        toKey: body.status,
        actorId: user.userId,
        source: 'MANUAL',
        reason: body.reason,
        lostReason: body.lostReason,
        lostNote: body.lostNote,
        wonValue: body.wonValue,
      });
    });
    void existing;
    const [lead] = await this.serializeMany(user, [updated]);
    return lead;
  }

  // ---- notes -----------------------------------------------------------------------------------------------------
  async addNote(user: Principal, id: string, body: z.infer<typeof createNoteSchema>) {
    await this.loadLead(user, id, 'leads:notes:create');
    const note = await this.s.tx(async (tx) => {
      await lockLead(tx, user.organizationId, id);
      const n = await tx.leadNote.create({ data: { organizationId: user.organizationId, leadId: id, authorId: user.userId, body: body.body, visibility: body.visibility } });
      await tx.lead.update({ where: { id }, data: { lastActivityAt: new Date() } });
      await syncLeadExceptions(tx, id);
      return n;
    });
    return { id: note.id, body: note.body, visibility: note.visibility, authorId: note.authorId, createdAt: note.createdAt.toISOString() };
  }

  // ---- timeline --------------------------------------------------------------------------------------------------
  async timeline(user: Principal, id: string, q: z.infer<typeof timelineQuerySchema>) {
    await this.loadLead(user, id, 'leads:timeline:view');
    const before = q.before ?? new Date(Date.now() + 60_000);
    const take = q.limit;
    const seePrivate = this.s.access.has(user, 'leads:notes:view-private');
    const [calls, notes, tasks, history, assigns, atts, merges] = await Promise.all([
      this.prisma.callLog.findMany({ where: { leadId: id, createdAt: { lt: before } }, orderBy: { createdAt: 'desc' }, take }),
      this.prisma.leadNote.findMany({ where: { leadId: id, createdAt: { lt: before }, ...(seePrivate ? {} : { OR: [{ visibility: 'SHARED' }, { authorId: user.userId }] }) }, orderBy: { createdAt: 'desc' }, take }),
      this.prisma.task.findMany({ where: { leadId: id, OR: [{ createdAt: { lt: before } }, { completedAt: { lt: before } }] }, orderBy: { createdAt: 'desc' }, take }),
      this.prisma.leadStatusHistory.findMany({ where: { leadId: id, createdAt: { lt: before } }, orderBy: { createdAt: 'desc' }, take }),
      this.prisma.leadAssignment.findMany({ where: { leadId: id, createdAt: { lt: before } }, orderBy: { createdAt: 'desc' }, take }),
      this.prisma.eventAttendance.findMany({ where: { leadId: id, updatedAt: { lt: before } }, include: { event: { select: { title: true, type: true, startsAt: true } } }, orderBy: { updatedAt: 'desc' }, take }),
      this.prisma.leadMerge.findMany({ where: { winnerId: id, createdAt: { lt: before } }, orderBy: { createdAt: 'desc' }, take }),
    ]);
    const names = await this.s.userNames([...calls.map((c) => c.userId), ...notes.map((n) => n.authorId), ...tasks.flatMap((t) => [t.createdById, t.completedById, t.assignedToId]), ...history.map((h) => h.changedById), ...assigns.flatMap((a) => [a.changedById, a.toUserId, a.fromUserId]), ...merges.map((m) => m.mergedById)]);
    const nm = (x: string | null) => (x ? (names.get(x) ?? null) : null);
    type Item = { type: string; at: Date; actorId: string | null; actorName: string | null; title: string; detail?: string | null; data: Record<string, unknown> };
    const items: Item[] = [];
    for (const c of calls) items.push({ type: 'call', at: c.createdAt, actorId: c.userId, actorName: nm(c.userId), title: `Call: ${c.outcome.replace('_', ' ').toLowerCase()}`, detail: c.notes, data: { id: c.id, outcome: c.outcome, source: c.source, label: c.source === 'MANUAL' ? 'MANUAL' : c.source, interestLevel: c.interestLevel, objectionCategory: c.objectionCategory, durationSeconds: c.durationSeconds } });
    for (const n of notes) items.push({ type: 'note', at: n.createdAt, actorId: n.authorId, actorName: nm(n.authorId), title: n.visibility === 'PRIVATE' ? 'Private note' : 'Note', detail: n.body, data: { id: n.id, visibility: n.visibility } });
    for (const t of tasks) {
      if (t.createdAt < before) items.push({ type: 'task', at: t.createdAt, actorId: t.createdById, actorName: nm(t.createdById), title: `Task created: ${t.title}`, data: { id: t.id, taskType: t.type, dueAt: t.dueAt.toISOString(), status: t.status, ruleKey: t.ruleKey } });
      if (t.completedAt && t.completedAt < before) items.push({ type: 'task', at: t.completedAt, actorId: t.completedById, actorName: nm(t.completedById), title: `Task ${t.status === 'DONE' ? 'completed' : 'cancelled'}: ${t.title}`, detail: t.completionNote, data: { id: t.id, status: t.status } });
    }
    for (const h of history) items.push({ type: 'status', at: h.createdAt, actorId: h.changedById, actorName: nm(h.changedById), title: h.oldStatus ? `Status: ${h.oldStatus} to ${h.newStatus}` : `Lead created as ${h.newStatus}`, detail: h.reason, data: { id: h.id, from: h.oldStatus, to: h.newStatus, source: h.source } });
    for (const a of assigns) items.push({ type: 'assignment', at: a.createdAt, actorId: a.changedById, actorName: nm(a.changedById), title: a.toUserId ? `Assigned to ${nm(a.toUserId) ?? 'a user'}` : 'Unassigned', detail: a.reason, data: { id: a.id, method: a.method, fromUserId: a.fromUserId, toUserId: a.toUserId } });
    for (const a of atts) items.push({ type: 'attendance', at: a.updatedAt, actorId: a.updatedById, actorName: nm(a.updatedById), title: `${a.event.type === 'DEMO' ? 'Demo' : a.event.type === 'WEBINAR' ? 'Webinar' : 'Event'} "${a.event.title}": ${a.status.replace('_', ' ').toLowerCase()}`, detail: a.reason, data: { id: a.id, status: a.status, startsAt: a.event.startsAt.toISOString() } });
    for (const m of merges) items.push({ type: 'merge', at: m.createdAt, actorId: m.mergedById, actorName: nm(m.mergedById), title: 'A duplicate lead was merged into this lead', data: { id: m.id, loserId: m.loserId } });
    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    const page = items.slice(0, take);
    return ok(page.map((i) => ({ ...i, at: i.at.toISOString() })), { pagination: { mode: 'cursor', limit: take, hasMore: items.length > take, nextCursor: items.length > take ? page[page.length - 1]!.at.toISOString() : null } });
  }

  // ---- saved views -----------------------------------------------------------------------------------------------
  listViews(user: Principal) {
    return this.prisma.leadSavedView.findMany({ where: { organizationId: user.organizationId, userId: user.userId }, orderBy: { name: 'asc' }, select: { id: true, name: true, filters: true } });
  }
  async saveView(user: Principal, body: { name: string; filters: Record<string, unknown> }) {
    const row = await this.prisma.leadSavedView.upsert({
      where: { userId_name: { userId: user.userId, name: body.name } },
      create: { organizationId: user.organizationId, userId: user.userId, name: body.name, filters: body.filters as Prisma.InputJsonValue },
      update: { filters: body.filters as Prisma.InputJsonValue },
    });
    return { id: row.id, name: row.name, filters: row.filters };
  }
  async deleteView(user: Principal, id: string) {
    const res = await this.prisma.leadSavedView.deleteMany({ where: { id, userId: user.userId, organizationId: user.organizationId } });
    if (!res.count) throw notFound('Saved view');
    return { deleted: true };
  }

  // ---- workspace -------------------------------------------------------------------------------------------------
  async workspace(user: Principal) {
    const now = new Date();
    const scopedLeads = await this.s.access.scopedWhere(user, { permission: 'leads:view', ownerField: 'assignedToId', teamField: 'teamId' });
    const wh = await getWorkingHours(this.prisma as unknown as Tx, user.organizationId, null);
    const endOfToday = new Date(now.getTime() + 24 * 3600_000);
    void wh;
    const mineOpen = and(scopedLeads, { mergedIntoId: null, stageCategory: 'OPEN' });
    const taskScope = this.s.access.has(user, 'tasks:view') ? await this.s.access.scopedWhere(user, { permission: 'tasks:view', ownerField: 'assignedToId', teamField: 'teamId' }) : null;
    const taskWhere = taskScope ? { ...taskScope, status: 'OPEN' as const } : null;
    const [priority, overdueCount, unattended, exceptionCount, tasksToday, pinned] = await Promise.all([
      this.prisma.lead.findMany({ where: and(mineOpen, { assignedToId: user.userId }), orderBy: [{ isKeyProspect: 'desc' }, { interestLevel: { sort: 'desc', nulls: 'last' } }, { nextActionAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }], take: 12 }),
      this.prisma.lead.count({ where: and(mineOpen, { assignedToId: user.userId, nextActionAt: { lt: now } }) }),
      this.prisma.leadException.count({ where: { organizationId: user.organizationId, resolvedAt: null, kind: 'UNATTENDED', lead: and(scopedLeads, { assignedToId: user.userId }) as Prisma.LeadWhereInput } }),
      this.s.access.has(user, 'leads:exceptions:view')
        ? this.prisma.leadException.count({ where: { organizationId: user.organizationId, resolvedAt: null, lead: and(scopedLeads, {}) as Prisma.LeadWhereInput } })
        : Promise.resolve(0),
      taskWhere ? this.prisma.task.findMany({ where: { ...taskWhere, assignedToId: user.userId, dueAt: { lt: endOfToday } }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: 50 }) : Promise.resolve([]),
      taskWhere ? this.prisma.task.findMany({ where: { ...taskWhere, assignedToId: user.userId, isPinned: true }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: 20 }) : Promise.resolve([]),
    ]);
    const leadIds = [...new Set([...tasksToday, ...pinned].flatMap((t) => (t.leadId ? [t.leadId] : [])))];
    const taskLeads = leadIds.length ? await this.prisma.lead.findMany({ where: { id: { in: leadIds }, organizationId: user.organizationId }, select: { id: true, fullName: true, phoneE164: true, phoneRaw: true } }) : [];
    const leadBy = new Map(taskLeads.map((l) => [l.id, l]));
    const sTask = (t: (typeof tasksToday)[number]) => ({ id: t.id, type: t.type, title: t.title, dueAt: t.dueAt.toISOString(), priority: t.priority, isPinned: t.isPinned, overdue: t.dueAt < now, leadId: t.leadId, lead: t.leadId && leadBy.get(t.leadId) ? { id: t.leadId, fullName: leadBy.get(t.leadId)!.fullName, phone: leadBy.get(t.leadId)!.phoneE164 ?? leadBy.get(t.leadId)!.phoneRaw } : null });
    const upcoming = await this.prisma.crmEvent.findMany({ where: { organizationId: user.organizationId, status: 'SCHEDULED', startsAt: { gte: now } }, orderBy: { startsAt: 'asc' }, take: 5, select: { id: true, title: true, type: true, startsAt: true } });
    return {
      counts: { overdueLeads: overdueCount, tasksToday: tasksToday.length, overdueTasks: tasksToday.filter((t) => t.dueAt < now).length, pinned: pinned.length, unattended, exceptions: exceptionCount },
      tasksToday: tasksToday.map(sTask),
      pinnedTasks: pinned.map(sTask),
      priorityLeads: await this.serializeMany(user, priority),
      upcomingEvents: upcoming.map((e) => ({ id: e.id, title: e.title, type: e.type, startsAt: e.startsAt.toISOString() })),
    };
  }
}

