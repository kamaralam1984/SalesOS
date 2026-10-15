import { Prisma, type Lead, type Task, type TaskPriority, type TaskType } from '@prisma/client';
import { CRM_EVENTS } from '@salesos/shared-types';
import { getRule, getWorkingHours, loadStages, resolveTeamId } from './config';
import type { CoreDeps, Tx } from './deps';
import { CrmError, crmNotFound } from './errors';
import { normalizeEmail, normalizePhone, phoneSuffix } from './phone';
import { evaluateTransition, type StageDef } from './stages';
import { addWorkingMinutes, startOfLocalDay } from './working-hours';

/** Serialise concurrent mutations of one lead (row lock held until the surrounding transaction ends). */
export async function lockLead(tx: Tx, organizationId: string, leadId: string): Promise<Lead> {
  await tx.$queryRaw`SELECT id FROM leads WHERE id = ${leadId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
  const lead = await tx.lead.findFirst({ where: { id: leadId, organizationId } });
  if (!lead) throw crmNotFound('Lead');
  return lead;
}

// ---------------------------------------------------------------------------------------------------------------
// Tasks and next action
// ---------------------------------------------------------------------------------------------------------------

export interface CreateTaskInput {
  organizationId: string;
  leadId?: string | null;
  assignedToId: string;
  createdById?: string | null;
  teamId?: string | null;
  type: TaskType;
  title: string;
  description?: string | null;
  dueAt: Date;
  priority?: TaskPriority;
  isPinned?: boolean;
  ruleKey?: string | null;
  idempotencyKey?: string | null;
}

/** Idempotent when idempotencyKey is given: returns the existing task with created=false. */
export async function createTaskTx(tx: Tx, deps: CoreDeps, input: CreateTaskInput): Promise<{ task: Task; created: boolean }> {
  if (input.idempotencyKey) {
    const existing = await tx.task.findFirst({ where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } });
    if (existing) return { task: existing, created: false };
  }
  const teamId = input.teamId ?? (await resolveTeamId(tx, input.organizationId, input.assignedToId));
  const task = await tx.task.create({
    data: {
      organizationId: input.organizationId,
      leadId: input.leadId ?? null,
      assignedToId: input.assignedToId,
      createdById: input.createdById ?? null,
      teamId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      dueAt: input.dueAt,
      priority: input.priority ?? 'NORMAL',
      isPinned: input.isPinned ?? false,
      ruleKey: input.ruleKey ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });
  await deps.publish(tx, {
    eventType: CRM_EVENTS.TASK_CREATED,
    aggregateType: 'task',
    aggregateId: task.id,
    organizationId: input.organizationId,
    payload: { taskId: task.id, leadId: task.leadId, assignedToId: task.assignedToId, dueAt: task.dueAt.toISOString(), type: task.type },
    idempotencyKey: `task.created:${task.id}`,
  });
  if (task.leadId) await syncLeadNextAction(tx, task.leadId);
  return { task, created: true };
}

/** next_action_at/type = earliest OPEN task of the lead (the lead always shows its next action). */
export async function syncLeadNextAction(tx: Tx, leadId: string): Promise<void> {
  const next = await tx.task.findFirst({ where: { leadId, status: 'OPEN' }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], select: { dueAt: true, type: true } });
  await tx.lead.updateMany({ where: { id: leadId }, data: { nextActionAt: next?.dueAt ?? null, nextActionType: next?.type ?? null } });
}

// ---------------------------------------------------------------------------------------------------------------
// Exceptions (materialised queue)
// ---------------------------------------------------------------------------------------------------------------

const AUTO_KINDS = ['NO_OWNER', 'NO_NEXT_ACTION'] as const;
type Kind = 'NO_OWNER' | 'NO_NEXT_ACTION' | 'UNATTENDED' | 'MANAGER_REVIEW' | 'OWNER_DEACTIVATED';

/** Keep the auto-managed exceptions (no owner / no next action) in step with the lead; resolve all when terminal. */
export async function syncLeadExceptions(tx: Tx, leadId: string): Promise<void> {
  const lead = await tx.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  const open = await tx.leadException.findMany({ where: { leadId, resolvedAt: null } });
  const now = new Date();
  const resolve = async (ids: string[]) => {
    if (ids.length) await tx.leadException.updateMany({ where: { id: { in: ids } }, data: { resolvedAt: now, openKey: null } });
  };
  if (lead.stageCategory !== 'OPEN') {
    await resolve(open.map((e) => e.id));
    return;
  }
  const wanted = new Set<Kind>();
  if (!lead.assignedToId) wanted.add('NO_OWNER');
  if (!lead.nextActionAt) wanted.add('NO_NEXT_ACTION');
  const toResolve: string[] = [];
  for (const e of open) {
    if ((AUTO_KINDS as readonly string[]).includes(e.kind) && !wanted.has(e.kind as Kind)) toResolve.push(e.id);
    if (e.kind === 'UNATTENDED' && lead.lastActivityAt && lead.lastActivityAt > e.detectedAt) toResolve.push(e.id);
    if ((e.kind === 'OWNER_DEACTIVATED' || e.kind === 'NO_OWNER') && lead.assignedToId) {
      const owner = await tx.user.findUnique({ where: { id: lead.assignedToId }, select: { isActive: true } });
      if (owner?.isActive) toResolve.push(e.id);
    }
  }
  await resolve(toResolve);
  const have = new Set(open.filter((e) => !toResolve.includes(e.id)).map((e) => e.kind));
  const create = [...wanted].filter((k) => !have.has(k));
  if (create.length) {
    await tx.leadException.createMany({
      data: create.map((kind) => ({
        organizationId: lead.organizationId,
        leadId,
        kind,
        openKey: `${leadId}:${kind}`,
        detail: kind === 'NO_OWNER' ? 'Active lead has no responsible owner' : 'Active lead has no next action',
      })),
      skipDuplicates: true,
    });
  }
}

/** Raise a (non auto) exception once per open (lead, kind); publishes lead.exception_raised. */
export async function raiseException(tx: Tx, deps: CoreDeps, lead: Pick<Lead, 'id' | 'organizationId' | 'assignedToId'>, kind: Kind, detail: string): Promise<boolean> {
  const res = await tx.leadException.createMany({
    data: [{ organizationId: lead.organizationId, leadId: lead.id, kind, openKey: `${lead.id}:${kind}`, detail }],
    skipDuplicates: true,
  });
  if (res.count === 0) return false;
  const row = await tx.leadException.findFirst({ where: { openKey: `${lead.id}:${kind}` } });
  await deps.publish(tx, {
    eventType: CRM_EVENTS.LEAD_EXCEPTION_RAISED,
    aggregateType: 'lead',
    aggregateId: lead.id,
    organizationId: lead.organizationId,
    payload: { leadId: lead.id, kind, detail, assignedToId: lead.assignedToId, exceptionId: row?.id ?? null },
    idempotencyKey: `lead.exception_raised:${row?.id ?? lead.id + kind}`,
  });
  return true;
}

export async function resolveExceptions(tx: Tx, leadId: string, kinds: Kind[]): Promise<void> {
  await tx.leadException.updateMany({ where: { leadId, resolvedAt: null, kind: { in: kinds } }, data: { resolvedAt: new Date(), openKey: null } });
}

// ---------------------------------------------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------------------------------------------

const nameKey = (n: string) => n.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function namesSimilar(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const [fa] = x.split(' ');
  const [fb] = y.split(' ');
  return !!fa && fa === fb;
}

/** Flag possible duplicates (DEC-011): phone exact, email exact (case-insens.), fuzzy name + phone suffix. Never merges. */
export async function detectDuplicates(tx: Tx, lead: Pick<Lead, 'id' | 'organizationId' | 'fullName' | 'phoneE164' | 'phoneRaw' | 'emailNormalized'>) {
  const found = new Map<string, 'PHONE_EXACT' | 'EMAIL_EXACT' | 'NAME_PHONE_SUFFIX'>();
  const base = { organizationId: lead.organizationId, id: { not: lead.id }, mergedIntoId: null };
  if (lead.phoneE164) {
    for (const o of await tx.lead.findMany({ where: { ...base, phoneE164: lead.phoneE164 }, select: { id: true }, take: 25 })) found.set(o.id, 'PHONE_EXACT');
  }
  if (lead.emailNormalized) {
    for (const o of await tx.lead.findMany({ where: { ...base, emailNormalized: lead.emailNormalized }, select: { id: true }, take: 25 })) if (!found.has(o.id)) found.set(o.id, 'EMAIL_EXACT');
  }
  const suffix = phoneSuffix(lead.phoneE164 ?? lead.phoneRaw);
  if (suffix) {
    const near = await tx.lead.findMany({
      where: { ...base, OR: [{ phoneE164: { endsWith: suffix } }, { phoneRaw: { endsWith: suffix } }] },
      select: { id: true, fullName: true },
      take: 25,
    });
    for (const o of near) if (!found.has(o.id) && namesSimilar(o.fullName, lead.fullName)) found.set(o.id, 'NAME_PHONE_SUFFIX');
  }
  if (found.size === 0) return [];
  const rows = [...found].map(([otherId, matchType]) => {
    const [a, b] = lead.id < otherId ? [lead.id, otherId] : [otherId, lead.id];
    return { organizationId: lead.organizationId, leadId: a, otherLeadId: b, matchType };
  });
  await tx.duplicateCandidate.createMany({ data: rows, skipDuplicates: true });
  await tx.lead.updateMany({ where: { id: { in: [lead.id, ...found.keys()] } }, data: { duplicateFlag: true } });
  return [...found.keys()];
}

// ---------------------------------------------------------------------------------------------------------------
// Assignment: round-robin + manual
// ---------------------------------------------------------------------------------------------------------------

/** DEC-008 round-robin over active executives of the team; persisted pointer (row-locked); optional daily cap/filters. */
export async function pickRoundRobin(tx: Tx, organizationId: string, teamId: string, filter: { sourceId?: string | null; programId?: string | null } = {}): Promise<string | null> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM assignment_rules WHERE organization_id = ${organizationId}::uuid AND team_id = ${teamId}::uuid FOR UPDATE`;
  if (!locked[0]) return null;
  const rule = await tx.assignmentRule.findUniqueOrThrow({ where: { id: locked[0].id } });
  if (!rule.isEnabled) return null;
  if (rule.sourceIds.length && (!filter.sourceId || !rule.sourceIds.includes(filter.sourceId))) return null;
  if (rule.programIds.length && (!filter.programId || !rule.programIds.includes(filter.programId))) return null;
  const members = await tx.teamMembership.findMany({
    where: {
      teamId,
      userId: { notIn: rule.excludedUserIds },
      user: { organizationId, isActive: true, roleAssignments: { some: { role: { key: 'SALES_EXECUTIVE' } } } },
    },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  });
  let candidates = members.map((m) => m.userId);
  if (rule.dailyCap && candidates.length) {
    const wh = await getWorkingHours(tx, organizationId, teamId);
    const since = startOfLocalDay(new Date(), wh.timezone);
    const counts = await tx.leadAssignment.groupBy({ by: ['toUserId'], where: { organizationId, method: 'ROUND_ROBIN', toUserId: { in: candidates }, createdAt: { gte: since } }, _count: { _all: true } });
    const byUser = new Map(counts.map((c) => [c.toUserId, c._count._all]));
    candidates = candidates.filter((u) => (byUser.get(u) ?? 0) < rule.dailyCap!);
  }
  if (!candidates.length) return null;
  const idx = rule.lastAssignedUserId ? candidates.findIndex((u) => u > rule.lastAssignedUserId!) : 0;
  const chosen = candidates[idx >= 0 ? idx : 0]!;
  await tx.assignmentRule.update({ where: { id: rule.id }, data: { lastAssignedUserId: chosen } });
  return chosen;
}

export interface AssignInput {
  lead: Lead;
  toUserId: string | null;
  actorId: string | null;
  method: 'MANUAL' | 'ROUND_ROBIN' | 'IMPORT' | 'REASSIGNMENT_QUEUE' | 'MERGE' | 'REACTIVATION' | 'SYSTEM';
  reason?: string | null;
}

/**
 * Assign/reassign a lead (history + audit + outbox, moves the previous owner's open tasks, resolves queue entries and
 * owner exceptions). The caller has validated that the target user is in the organization and allowed.
 */
export async function assignLeadTx(tx: Tx, deps: CoreDeps, input: AssignInput): Promise<Lead> {
  const { lead } = input;
  const from = lead.assignedToId;
  const to = input.toUserId;
  const teamId = to ? ((await resolveTeamId(tx, lead.organizationId, to)) ?? lead.teamId) : lead.teamId;
  const now = new Date();
  const updated = await tx.lead.update({ where: { id: lead.id }, data: { assignedToId: to, teamId, assignedAt: to ? now : null, version: { increment: 1 } } });
  await tx.leadAssignment.create({ data: { organizationId: lead.organizationId, leadId: lead.id, fromUserId: from, toUserId: to, changedById: input.actorId, method: input.method, reason: input.reason ?? null } });
  if (from !== to) {
    if (from && to) await tx.task.updateMany({ where: { leadId: lead.id, status: 'OPEN', assignedToId: from }, data: { assignedToId: to, teamId, version: { increment: 1 } } });
    await tx.reassignmentQueueEntry.updateMany({
      where: { leadId: lead.id, status: 'OPEN' },
      data: { status: 'RESOLVED', openKey: null, resolvedAt: now, resolvedById: input.actorId, newOwnerId: to, resolutionNote: input.reason ?? 'Reassigned' },
    });
    if (from && to) {
      const openTasks = await tx.task.findMany({ where: { leadId: lead.id, assignedToId: to, status: 'OPEN' }, select: { id: true } });
      await tx.reassignmentQueueEntry.updateMany({
        where: { taskId: { in: openTasks.map((t) => t.id) }, status: 'OPEN' },
        data: { status: 'RESOLVED', openKey: null, resolvedAt: now, resolvedById: input.actorId, newOwnerId: to, resolutionNote: 'Moved with lead' },
      });
    }
    await resolveExceptions(tx, lead.id, ['OWNER_DEACTIVATED', 'NO_OWNER', 'MANAGER_REVIEW']);
  }
  await deps.audit(tx, {
    organizationId: lead.organizationId,
    actorId: input.actorId,
    action: 'ownership.changed',
    entityType: 'lead',
    entityId: lead.id,
    metadata: { fromUserId: from, toUserId: to, method: input.method, reason: input.reason ?? null },
  });
  await deps.publish(tx, {
    eventType: CRM_EVENTS.LEAD_ASSIGNED,
    aggregateType: 'lead',
    aggregateId: lead.id,
    organizationId: lead.organizationId,
    payload: { leadId: lead.id, fromUserId: from, toUserId: to, changedById: input.actorId, method: input.method },
    idempotencyKey: `lead.assigned:${lead.id}:${updated.version}`,
  });
  // A freshly owned, untouched lead gets its first-contact task (SLA) so it always has a next action.
  if (to && updated.stageCategory === 'OPEN' && updated.callAttemptCount === 0) {
    const open = await tx.task.count({ where: { leadId: lead.id, status: 'OPEN' } });
    if (open === 0) await createFirstContactTask(tx, deps, updated, to);
  }
  await syncLeadNextAction(tx, lead.id);
  await syncLeadExceptions(tx, lead.id);
  return tx.lead.findUniqueOrThrow({ where: { id: lead.id } });
}

export async function createFirstContactTask(tx: Tx, deps: CoreDeps, lead: Lead, ownerId: string) {
  const rule = await getRule(tx, lead.organizationId, lead.teamId, 'FIRST_CONTACT');
  if (!rule.enabled) return null;
  const wh = await getWorkingHours(tx, lead.organizationId, lead.teamId);
  const { task } = await createTaskTx(tx, deps, {
    organizationId: lead.organizationId,
    leadId: lead.id,
    assignedToId: ownerId,
    createdById: null,
    teamId: lead.teamId,
    type: 'CALL',
    title: `First contact: ${lead.fullName}`,
    dueAt: addWorkingMinutes(new Date(), rule.dueWorkingMinutes, wh),
    priority: 'HIGH',
    ruleKey: 'FIRST_CONTACT',
    idempotencyKey: `first-contact:${lead.id}:${ownerId}`,
  });
  return task;
}

// ---------------------------------------------------------------------------------------------------------------
// Create lead
// ---------------------------------------------------------------------------------------------------------------

export interface CreateLeadInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  sourceId?: string | null;
  campaignId?: string | null;
  programId?: string | null;
  assignedToId?: string | null;
  teamId?: string | null;
  interestLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  estimatedValue?: string | number | null;
  currency?: string;
  preferredLanguage?: string | null;
  consentStatus?: 'UNKNOWN' | 'GRANTED' | 'WITHDRAWN' | 'DND';
  consentAt?: Date | null;
  consentSource?: string | null;
  isKeyProspect?: boolean;
  note?: string | null;
  createKey?: string | null;
  importJobId?: string | null;
  importRowKey?: string | null;
  /** 'round_robin' = use the team's rule when no explicit owner */
  autoAssign?: 'round_robin' | 'none';
  assignmentMethod?: 'MANUAL' | 'ROUND_ROBIN' | 'IMPORT';
  defaultRegion?: 'IN' | string;
}

export interface Actor {
  userId: string | null;
  organizationId: string;
  /** actor's own team; used when the lead is created unowned so the team manager sees the exception */
  teamId?: string | null;
}

export interface CreateLeadResult {
  lead: Lead;
  created: boolean;
  duplicateLeadIds: string[];
  warnings: string[];
}

async function assertSourceProgram(tx: Tx, organizationId: string, input: CreateLeadInput) {
  if (input.sourceId && !(await tx.leadSource.findFirst({ where: { id: input.sourceId, organizationId }, select: { id: true } }))) throw new CrmError('VALIDATION_ERROR', 'Unknown lead source', 422);
  if (input.campaignId && !(await tx.leadCampaign.findFirst({ where: { id: input.campaignId, organizationId }, select: { id: true } }))) throw new CrmError('VALIDATION_ERROR', 'Unknown campaign', 422);
  if (input.programId && !(await tx.program.findFirst({ where: { id: input.programId, organizationId }, select: { id: true } }))) throw new CrmError('VALIDATION_ERROR', 'Unknown program', 422);
}

export async function createLeadTx(tx: Tx, deps: CoreDeps, actor: Actor, input: CreateLeadInput): Promise<CreateLeadResult> {
  const org = actor.organizationId;
  if (input.createKey) {
    const ex = await tx.lead.findFirst({ where: { organizationId: org, createKey: input.createKey } });
    if (ex) return { lead: ex, created: false, duplicateLeadIds: [], warnings: [] };
  }
  if (input.importRowKey) {
    const ex = await tx.lead.findFirst({ where: { organizationId: org, importRowKey: input.importRowKey } });
    if (ex) return { lead: ex, created: false, duplicateLeadIds: [], warnings: [] };
  }
  const fullName = input.fullName.trim();
  if (!fullName) throw new CrmError('VALIDATION_ERROR', 'Full name is required', 422);
  const phone = normalizePhone(input.phone, (input.defaultRegion ?? 'IN') as 'IN');
  const email = normalizeEmail(input.email);
  if (!phone.raw && !email) throw new CrmError('VALIDATION_ERROR', 'A phone number or an email is required', 422);
  const warnings: string[] = [];
  if (phone.raw && !phone.valid) warnings.push(`Phone "${phone.raw}" could not be normalised to E.164 and was kept as raw (flagged)`);
  await assertSourceProgram(tx, org, input);

  const stages = await loadStages(tx, org);
  const first = stages.filter((s) => s.category === 'OPEN' && s.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder)[0];
  if (!first) throw new CrmError('CONFIG_ERROR', 'No open lead stage configured', 500);

  let ownerId = input.assignedToId ?? null;
  let method: 'MANUAL' | 'ROUND_ROBIN' | 'IMPORT' = input.assignmentMethod ?? 'MANUAL';
  let teamId = input.teamId ?? actor.teamId ?? null;
  if (!ownerId && input.autoAssign === 'round_robin' && teamId) {
    ownerId = await pickRoundRobin(tx, org, teamId, { sourceId: input.sourceId, programId: input.programId });
    if (ownerId) method = 'ROUND_ROBIN';
    else warnings.push('Round-robin is not enabled or no eligible executive was available: lead left unassigned (exception queue)');
  }
  if (ownerId) teamId = (await resolveTeamId(tx, org, ownerId)) ?? teamId;

  const now = new Date();
  const consent = input.consentStatus ?? 'UNKNOWN';
  const lead = await tx.lead.create({
    data: {
      organizationId: org,
      fullName,
      phoneE164: phone.e164,
      phoneRaw: phone.raw || null,
      phoneValid: phone.raw ? phone.valid : true,
      email: input.email?.trim() || null,
      emailNormalized: email,
      sourceId: input.sourceId ?? null,
      campaignId: input.campaignId ?? null,
      programId: input.programId ?? null,
      assignedToId: ownerId,
      teamId,
      status: first.key,
      stageCategory: first.category,
      interestLevel: input.interestLevel ?? null,
      estimatedValue: input.estimatedValue !== undefined && input.estimatedValue !== null ? new Prisma.Decimal(input.estimatedValue) : null,
      currency: input.currency ?? 'INR',
      preferredLanguage: input.preferredLanguage ?? null,
      isKeyProspect: input.isKeyProspect ?? false,
      consentStatus: consent,
      consentAt: input.consentAt ?? (consent === 'GRANTED' ? now : null),
      consentSource: input.consentSource ?? null,
      assignedAt: ownerId ? now : null,
      createKey: input.createKey ?? null,
      importJobId: input.importJobId ?? null,
      importRowKey: input.importRowKey ?? null,
      createdById: actor.userId,
    },
  });
  await tx.leadStatusHistory.create({
    data: { organizationId: org, leadId: lead.id, oldStatus: null, newStatus: first.key, oldCategory: null, newCategory: first.category, changedById: actor.userId, source: input.importJobId ? 'IMPORT' : 'MANUAL', reason: 'Lead created' },
  });
  if (ownerId) {
    await tx.leadAssignment.create({ data: { organizationId: org, leadId: lead.id, fromUserId: null, toUserId: ownerId, changedById: actor.userId, method, reason: 'Assigned on creation' } });
  }
  if (input.note?.trim() && actor.userId) {
    await tx.leadNote.create({ data: { organizationId: org, leadId: lead.id, authorId: actor.userId, body: input.note.trim() } });
  }
  const dups = await detectDuplicates(tx, lead);
  if (dups.length) warnings.push(`Possible duplicate of ${dups.length} existing lead(s): flagged for review (not merged)`);
  if (ownerId) await createFirstContactTask(tx, deps, lead, ownerId);
  await syncLeadNextAction(tx, lead.id);
  await syncLeadExceptions(tx, lead.id);
  await deps.audit(tx, { organizationId: org, actorId: actor.userId, action: 'lead.created', entityType: 'lead', entityId: lead.id, metadata: { sourceId: lead.sourceId, programId: lead.programId, assignedToId: ownerId, method, duplicates: dups.length, imported: !!input.importJobId } });
  await deps.publish(tx, {
    eventType: CRM_EVENTS.LEAD_CREATED,
    aggregateType: 'lead',
    aggregateId: lead.id,
    organizationId: org,
    payload: { leadId: lead.id, assignedToId: ownerId, sourceId: lead.sourceId, programId: lead.programId, duplicateOfLeadIds: dups },
    idempotencyKey: `lead.created:${lead.id}`,
  });
  return { lead: await tx.lead.findUniqueOrThrow({ where: { id: lead.id } }), created: true, duplicateLeadIds: dups, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// Status transition (single entry point)
// ---------------------------------------------------------------------------------------------------------------

export interface TransitionInput {
  lead: Lead;
  stages: StageDef[];
  toKey: string;
  actorId: string | null;
  source: 'MANUAL' | 'CALL' | 'SYSTEM' | 'IMPORT' | 'MERGE' | 'EVENT';
  reason?: string | null;
  lostReason?: string | null;
  lostNote?: string | null;
  wonValue?: string | number | null;
  wonAt?: Date | null;
  callLogId?: string | null;
  /** record `reason` as a history row but do not enforce reason requirements (system hops) */
  system?: boolean;
}

export async function transitionLeadTx(tx: Tx, deps: CoreDeps, input: TransitionInput): Promise<Lead> {
  const { lead, stages, toKey } = input;
  const verdict = evaluateTransition(stages, lead.status, toKey);
  if (!verdict.allowed) {
    throw new CrmError('INVALID_TRANSITION', `Cannot move lead from ${lead.status} to ${toKey} (${verdict.code})`, 409, { from: lead.status, to: toKey, code: verdict.code });
  }
  const to = stages.find((s) => s.key === toKey)!;
  const reason = input.reason?.trim() || null;
  if (verdict.needsReason && to.category !== 'LOST' && !reason && !input.system) throw new CrmError('REASON_REQUIRED', 'A reason is required for this move', 422);

  const now = new Date();
  const data: Prisma.LeadUncheckedUpdateInput = { status: toKey, stageCategory: to.category, version: { increment: 1 }, lastActivityAt: now };
  let lostCfg: { reactivateAfterDays: number | null } | null = null;
  if (to.category === 'LOST') {
    const key = input.lostReason?.trim();
    if (!key) throw new CrmError('LOST_REASON_REQUIRED', 'A lost reason is required to mark a lead as lost', 422);
    const cfg = await tx.lostReasonConfig.findFirst({ where: { organizationId: lead.organizationId, key, isActive: true } });
    if (!cfg) throw new CrmError('VALIDATION_ERROR', `Unknown lost reason ${key}`, 422);
    if (cfg.requiresNote && !input.lostNote?.trim()) throw new CrmError('LOST_NOTE_REQUIRED', `A note is required when the lost reason is ${cfg.label}`, 422);
    data.lostReason = key;
    data.lostNote = input.lostNote?.trim() || null;
    data.lostAt = now;
    lostCfg = cfg;
  }
  if (to.category === 'WON') {
    data.wonAt = input.wonAt ?? now;
    if (input.wonValue !== undefined && input.wonValue !== null) data.wonValue = new Prisma.Decimal(input.wonValue);
  }
  if (to.category === 'OPEN' && (lead.stageCategory === 'LOST' || lead.stageCategory === 'NURTURE')) {
    data.lostAt = null; // lost_reason retained in history/audit; field cleared on reopen
    data.lostReason = null;
    data.lostNote = null;
  }
  if (to.category === 'OPEN' && lead.stageCategory === 'OPEN' && toKey !== 'CONTACT_ATTEMPTED' && toKey !== 'NEW') data.consecutiveSwitchedOff = 0;
  const updated = await tx.lead.update({ where: { id: lead.id }, data });
  await tx.leadStatusHistory.create({
    data: { organizationId: lead.organizationId, leadId: lead.id, oldStatus: lead.status, newStatus: toKey, oldCategory: lead.stageCategory, newCategory: to.category, changedById: input.actorId, source: input.source, reason: reason ?? input.lostReason ?? null, callLogId: input.callLogId ?? null },
  });
  const action = to.category === 'LOST' ? 'lead.lost' : to.category === 'WON' ? 'lead.won' : lead.stageCategory === 'LOST' || lead.stageCategory === 'NURTURE' ? 'lead.reopened' : 'lead.status_changed';
  await deps.audit(tx, { organizationId: lead.organizationId, actorId: input.actorId, action, entityType: 'lead', entityId: lead.id, metadata: { from: lead.status, to: toKey, reason, lostReason: input.lostReason ?? null, source: input.source } });
  await deps.publish(tx, {
    eventType: CRM_EVENTS.LEAD_STATUS_CHANGED,
    aggregateType: 'lead',
    aggregateId: lead.id,
    organizationId: lead.organizationId,
    payload: { leadId: lead.id, oldStatus: lead.status, newStatus: toKey, newCategory: to.category, changedById: input.actorId, reason },
    idempotencyKey: `lead.status_changed:${lead.id}:${updated.version}`,
  });

  if (to.category === 'LOST') {
    await tx.task.updateMany({ where: { leadId: lead.id, status: 'OPEN' }, data: { status: 'CANCELLED', completedAt: now, completionNote: 'Cancelled: lead marked lost', version: { increment: 1 } } });
    await deps.publish(tx, { eventType: CRM_EVENTS.LEAD_LOST, aggregateType: 'lead', aggregateId: lead.id, organizationId: lead.organizationId, payload: { leadId: lead.id, lostReason: input.lostReason, lostAt: now.toISOString() }, idempotencyKey: `lead.lost:${lead.id}:${updated.version}` });
    await scheduleReactivationTx(tx, updated, lostCfg?.reactivateAfterDays ?? null);
  }
  if (to.category === 'WON') {
    await tx.task.updateMany({ where: { leadId: lead.id, status: 'OPEN' }, data: { status: 'CANCELLED', completedAt: now, completionNote: 'Resolved: lead won', version: { increment: 1 } } });
    await deps.publish(tx, { eventType: CRM_EVENTS.LEAD_WON, aggregateType: 'lead', aggregateId: lead.id, organizationId: lead.organizationId, payload: { leadId: lead.id, assignedToId: updated.assignedToId, programId: updated.programId, value: updated.wonValue?.toString() ?? null, currency: updated.currency, wonAt: (updated.wonAt ?? now).toISOString() }, idempotencyKey: `lead.won:${lead.id}` });
    await tx.reactivationEntry.updateMany({ where: { leadId: lead.id, openKey: { not: null } }, data: { status: 'ARCHIVED', openKey: null, resolvedAt: now, outcome: 'WON' } });
  }
  if (to.category === 'OPEN' && (lead.stageCategory === 'LOST' || lead.stageCategory === 'NURTURE')) {
    await tx.reactivationEntry.updateMany({ where: { leadId: lead.id, openKey: { not: null } }, data: { status: 'REACTIVATED', openKey: null, resolvedAt: now, outcome: 'REOPENED' } });
  }
  if (to.category === 'NURTURE') {
    await tx.reactivationEntry.updateMany({ where: { leadId: lead.id, openKey: { not: null }, status: 'PENDING' }, data: { status: 'ELIGIBLE' } });
  }
  await syncLeadNextAction(tx, lead.id);
  await syncLeadExceptions(tx, lead.id);
  return tx.lead.findUniqueOrThrow({ where: { id: lead.id } });
}

/** DEC-031: queue for reactivation after N days unless consent withdrawn/DND or the reason is excluded. */
export async function scheduleReactivationTx(tx: Tx, lead: Lead, afterDays: number | null): Promise<void> {
  if (afterDays === null || lead.consentStatus === 'WITHDRAWN' || lead.consentStatus === 'DND') return;
  const rule = await getRule(tx, lead.organizationId, lead.teamId, 'REACTIVATION');
  if (lead.reactivationCount >= rule.maxAttempts) {
    return;
  }
  await tx.reactivationEntry.createMany({
    data: [{ organizationId: lead.organizationId, leadId: lead.id, teamId: lead.teamId, lostReason: lead.lostReason, eligibleFrom: new Date(Date.now() + afterDays * 86_400_000), attempts: lead.reactivationCount, status: 'PENDING', openKey: `lead:${lead.id}` }],
    skipDuplicates: true,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Reassignment queue
// ---------------------------------------------------------------------------------------------------------------

/**
 * user.deactivated handler core: a reassignment-queue entry for every open lead and open task owned by the user.
 * Idempotent (unique open_key per lead/task); safe to re-run for the same event.
 */
export async function queueOwnerDeactivation(
  prisma: { $transaction<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> },
  deps: CoreDeps,
  args: { organizationId: string; userId: string; eventId: string; managerId: string | null },
): Promise<{ leads: number; tasks: number }> {
  const { organizationId, userId, eventId } = args;
  let leads = 0;
  let tasks = 0;
  let cursor: string | undefined;
  for (;;) {
    const done = await prisma.$transaction(async (tx) => {
      const batch = await tx.lead.findMany({
        where: { organizationId, assignedToId: userId, stageCategory: 'OPEN', mergedIntoId: null },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const lead of batch) {
        const res = await tx.reassignmentQueueEntry.createMany({
          data: [{ organizationId, leadId: lead.id, reason: 'OWNER_DEACTIVATED', previousOwnerId: userId, teamId: lead.teamId, openKey: `lead:${lead.id}`, sourceEventId: eventId }],
          skipDuplicates: true,
        });
        if (res.count) {
          leads++;
          const entry = await tx.reassignmentQueueEntry.findFirst({ where: { openKey: `lead:${lead.id}` } });
          await deps.publish(tx, { eventType: CRM_EVENTS.REASSIGNMENT_QUEUED, aggregateType: 'lead', aggregateId: lead.id, organizationId, payload: { entryId: entry?.id, leadId: lead.id, taskId: null, previousOwnerId: userId, reason: 'OWNER_DEACTIVATED', managerId: args.managerId }, idempotencyKey: `reassignment.queued:${eventId}:lead:${lead.id}` });
        }
        await raiseException(tx, deps, lead, 'OWNER_DEACTIVATED', 'Owner was deactivated: reassign this lead');
      }
      cursor = batch.length ? batch[batch.length - 1]!.id : undefined;
      return batch.length < 200;
    });
    if (done) break;
  }
  cursor = undefined;
  for (;;) {
    const done = await prisma.$transaction(async (tx) => {
      const batch = await tx.task.findMany({
        where: { organizationId, assignedToId: userId, status: 'OPEN' },
        orderBy: { id: 'asc' },
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const task of batch) {
        const res = await tx.reassignmentQueueEntry.createMany({
          data: [{ organizationId, taskId: task.id, leadId: task.leadId, reason: 'OWNER_DEACTIVATED', previousOwnerId: userId, teamId: task.teamId, openKey: `task:${task.id}`, sourceEventId: eventId }],
          skipDuplicates: true,
        });
        if (res.count) tasks++;
      }
      cursor = batch.length ? batch[batch.length - 1]!.id : undefined;
      return batch.length < 200;
    });
    if (done) break;
  }
  return { leads, tasks };
}

// ---------------------------------------------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------------------------------------------

export type AgeingBucket = '0-1d' | '2-3d' | '4-7d' | '8-14d' | '15-30d' | '30d+';
export const AGEING_BUCKETS: AgeingBucket[] = ['0-1d', '2-3d', '4-7d', '8-14d', '15-30d', '30d+'];
export function ageingBucket(days: number): AgeingBucket {
  return days <= 1 ? '0-1d' : days <= 3 ? '2-3d' : days <= 7 ? '4-7d' : days <= 14 ? '8-14d' : days <= 30 ? '15-30d' : '30d+';
}
/** Lead ageing: since creation AND since last meaningful activity (falls back to creation when untouched). */
export function leadAgeing(lead: Pick<Lead, 'createdAt' | 'lastActivityAt'>, now = new Date()) {
  const day = 86_400_000;
  const sinceCreationDays = Math.floor((now.getTime() - lead.createdAt.getTime()) / day);
  const sinceActivityDays = Math.floor((now.getTime() - (lead.lastActivityAt ?? lead.createdAt).getTime()) / day);
  return { sinceCreationDays, sinceActivityDays, creationBucket: ageingBucket(sinceCreationDays), activityBucket: ageingBucket(sinceActivityDays) };
}
