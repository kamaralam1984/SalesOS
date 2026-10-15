import type { Lead, PrismaClient, Task } from '@prisma/client';
import {
  CRM_EVENTS,
  type LeadUnattendedPayload,
  type TaskNotifyPayload,
} from '@salesos/shared-types';
import {
  directDeps,
  getRule,
  getWorkingHours,
  leadAgeing,
  loadStages,
  raiseException,
  syncLeadExceptions,
  transitionLeadTx,
  workingMinutesBetween,
  workingMinutesPerDay,
  AGEING_BUCKETS,
  type CoreDeps,
  type Tx,
} from '@salesos/crm-core';
import type { Logger } from '../../logger';

export interface ScanContext {
  prisma: PrismaClient;
  log: Logger;
  deps?: CoreDeps;
  workerId?: string;
  now?: () => Date;
  /** test seam: called after a batch of tasks was claimed and before it is processed (simulate a crash with throw) */
  afterClaim?: (tasks: Task[]) => void | Promise<void>;
}

const LOCK_MS = 2 * 60_000;
const deps = (c: ScanContext) => c.deps ?? directDeps();
const nowOf = (c: ScanContext) => (c.now ? c.now() : new Date());

/**
 * Atomic task claim (compare-and-set via FOR UPDATE SKIP LOCKED): a task is processed by exactly one worker at a
 * time; the claim expires (locked_until) so work held by a crashed worker is picked up again on the next scan.
 */
export async function claimTasks(prisma: PrismaClient, kind: 'reminders' | 'overdue', workerId: string, limit = 200): Promise<Task[]> {
  const lockMs = LOCK_MS;
  if (kind === 'reminders') {
    return prisma.$queryRaw<Task[]>`
      UPDATE tasks SET locked_by = ${workerId}, locked_until = now() + (${lockMs}::int * interval '1 millisecond')
      WHERE id IN (
        SELECT id FROM tasks
        WHERE status = 'OPEN' AND reminded_at IS NULL AND (locked_until IS NULL OR locked_until < now())
          AND due_at <= now() + interval '1 day'
        ORDER BY due_at ASC LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, organization_id AS "organizationId", lead_id AS "leadId", assigned_to_id AS "assignedToId", team_id AS "teamId",
        type, title, due_at AS "dueAt", priority, is_pinned AS "isPinned", overdue_level AS "overdueLevel", reminded_at AS "remindedAt"`;
  }
  return prisma.$queryRaw<Task[]>`
    UPDATE tasks SET locked_by = ${workerId}, locked_until = now() + (${lockMs}::int * interval '1 millisecond')
    WHERE id IN (
      SELECT id FROM tasks
      WHERE status = 'OPEN' AND overdue_level < 4 AND (locked_until IS NULL OR locked_until < now())
        AND due_at <= now()
      ORDER BY due_at ASC LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    RETURNING id, organization_id AS "organizationId", lead_id AS "leadId", assigned_to_id AS "assignedToId", team_id AS "teamId",
      type, title, due_at AS "dueAt", priority, is_pinned AS "isPinned", overdue_level AS "overdueLevel", reminded_at AS "remindedAt"`;
}

const release = (prisma: PrismaClient, ids: string[]) => prisma.task.updateMany({ where: { id: { in: ids } }, data: { lockedBy: null, lockedUntil: null } });
const epoch = (d: Date) => d.getTime();

/**
 * Emits task.reminder (CALLBACK / pinned tasks, N minutes before due) and task.due (at due time) outbox events with
 * idempotent keys (task, window, dueAt epoch). Re-running - after a crash or on several workers - cannot duplicate.
 */
export async function scanDueReminders(c: ScanContext): Promise<{ claimed: number; published: number }> {
  const now = nowOf(c);
  const claimed = await claimTasks(c.prisma, 'reminders', c.workerId ?? `w-${process.pid}`);
  if (!claimed.length) return { claimed: 0, published: 0 };
  await c.afterClaim?.(claimed);
  const d = deps(c);
  let published = 0;
  try {
    for (const t of claimed) {
      const rule = await c.prisma.$transaction((tx) => getRule(tx, t.organizationId, t.teamId, 'CALLBACK'));
      const remindAt = new Date(epoch(t.dueAt) - rule.reminderMinutesBefore * 60_000);
      const isCallback = t.type === 'CALLBACK' || t.isPinned;
      await c.prisma.$transaction(async (tx) => {
        if (isCallback && now >= remindAt && now < t.dueAt) {
          const payload: TaskNotifyPayload = { taskId: t.id, leadId: t.leadId, assignedToId: t.assignedToId, dueAt: t.dueAt.toISOString(), window: `reminder:${epoch(t.dueAt)}` };
          if (await d.publish(tx, { eventType: CRM_EVENTS.TASK_REMINDER, aggregateType: 'task', aggregateId: t.id, organizationId: t.organizationId, payload: payload as unknown as Record<string, unknown>, idempotencyKey: `task.reminder:${t.id}:${epoch(t.dueAt)}` })) published++;
        }
        if (now >= t.dueAt) {
          const payload: TaskNotifyPayload = { taskId: t.id, leadId: t.leadId, assignedToId: t.assignedToId, dueAt: t.dueAt.toISOString(), window: `due:${epoch(t.dueAt)}` };
          if (await d.publish(tx, { eventType: CRM_EVENTS.TASK_DUE, aggregateType: 'task', aggregateId: t.id, organizationId: t.organizationId, payload: payload as unknown as Record<string, unknown>, idempotencyKey: `task.due:${t.id}:${epoch(t.dueAt)}` })) published++;
          await tx.task.updateMany({ where: { id: t.id, status: 'OPEN', remindedAt: null }, data: { remindedAt: now } });
        }
      });
    }
  } finally {
    await release(c.prisma, claimed.map((t) => t.id));
  }
  return { claimed: claimed.length, published };
}

/** Walks users.manager_id upward; returns the first user holding the role (or the direct manager when role is null). */
async function ladder(prisma: PrismaClient, orgId: string, userId: string, role: 'SALES_TEAM_LEAD' | null): Promise<string | null> {
  let cur = userId;
  for (let i = 0; i < 8; i++) {
    const u = await prisma.user.findFirst({ where: { id: cur, organizationId: orgId }, select: { managerId: true } });
    if (!u?.managerId) {
      if (!role) {
        const t = await prisma.teamMembership.findFirst({ where: { userId: userId, team: { organizationId: orgId, leadUserId: { not: null } } }, select: { team: { select: { leadUserId: true } } } });
        return t?.team.leadUserId && t.team.leadUserId !== userId ? t.team.leadUserId : null;
      }
      return null;
    }
    if (!role) return u.managerId;
    const holds = await prisma.userRoleAssignment.count({ where: { userId: u.managerId, role: { key: role } } });
    if (holds) return u.managerId;
    cur = u.managerId;
  }
  return null;
}

/**
 * Overdue handling per DEC-026: notify owner at due+0 (level 1), again after +4h (level 2), escalate to the owner's
 * manager after 1 working day (level 3) and to the Team Lead after 3 working days (level 4). Thresholds come from the
 * OVERDUE rule (org < team) and the WORKING_HOURS rule. Each level fires once (outbox idempotency key per level).
 */
export async function scanOverdue(c: ScanContext): Promise<{ claimed: number; published: number }> {
  const now = nowOf(c);
  const claimed = await claimTasks(c.prisma, 'overdue', c.workerId ?? `w-${process.pid}`);
  const overdue = claimed.filter((t) => t.dueAt <= now);
  const notDue = claimed.filter((t) => t.dueAt > now);
  if (notDue.length) await release(c.prisma, notDue.map((t) => t.id));
  if (!overdue.length) return { claimed: claimed.length, published: 0 };
  await c.afterClaim?.(overdue);
  const d = deps(c);
  let published = 0;
  try {
    for (const t of overdue) {
      const { rule, wh } = await c.prisma.$transaction(async (tx) => ({ rule: await getRule(tx, t.organizationId, t.teamId, 'OVERDUE'), wh: await getWorkingHours(tx, t.organizationId, t.teamId) }));
      const sinceMin = Math.floor((now.getTime() - t.dueAt.getTime()) / 60_000);
      const wMin = workingMinutesBetween(t.dueAt, now, wh);
      const perDay = workingMinutesPerDay(wh) || 600;
      let level = 0;
      if (sinceMin >= rule.notifyOwnerAtMinutes) level = 1;
      if (sinceMin >= rule.notifyOwnerAtMinutes + rule.repeatOwnerAfterMinutes) level = 2;
      if (wMin >= rule.escalateManagerAfterWorkingDays * perDay) level = 3;
      if (wMin >= rule.escalateTeamLeadAfterWorkingDays * perDay) level = 4;
      if (level <= t.overdueLevel) continue;
      const recipients: Record<number, string | null> = { 1: t.assignedToId, 2: t.assignedToId, 3: await ladder(c.prisma, t.organizationId, t.assignedToId, null), 4: await ladder(c.prisma, t.organizationId, t.assignedToId, 'SALES_TEAM_LEAD') };
      await c.prisma.$transaction(async (tx) => {
        for (let l = t.overdueLevel + 1; l <= level; l++) {
          const rid = recipients[l];
          if (!rid) continue; // no manager / team lead configured: level is recorded, nobody to notify
          const payload: TaskNotifyPayload = { taskId: t.id, leadId: t.leadId, assignedToId: t.assignedToId, dueAt: t.dueAt.toISOString(), window: `overdue:${epoch(t.dueAt)}:${l}`, recipientId: rid, level: l };
          if (await d.publish(tx, { eventType: l >= 3 ? CRM_EVENTS.TASK_ESCALATED : CRM_EVENTS.TASK_OVERDUE, aggregateType: 'task', aggregateId: t.id, organizationId: t.organizationId, payload: payload as unknown as Record<string, unknown>, idempotencyKey: `task.overdue:${t.id}:${epoch(t.dueAt)}:${l}` })) published++;
        }
        await tx.task.updateMany({ where: { id: t.id, status: 'OPEN', overdueLevel: t.overdueLevel }, data: { overdueLevel: level } });
      });
    }
  } finally {
    await release(c.prisma, overdue.map((t) => t.id));
  }
  return { claimed: claimed.length, published };
}

/**
 * Unattended leads: no meaningful activity for N WORKING days (or a NEW lead with no first contact for N minutes of
 * working time). Raises an UNATTENDED exception (once per open row) and a lead.unattended outbox event per quiet period.
 */
export async function scanUnattended(c: ScanContext): Promise<{ checked: number; raised: number }> {
  const now = nowOf(c);
  const d = deps(c);
  let cursor: string | undefined;
  let checked = 0;
  let raised = 0;
  for (;;) {
    const batch: Lead[] = await c.prisma.lead.findMany({
      where: { stageCategory: 'OPEN', mergedIntoId: null, assignedToId: { not: null }, OR: [{ lastActivityAt: { lt: new Date(now.getTime() - 3600_000) } }, { lastActivityAt: null }] },
      orderBy: { id: 'asc' },
      take: 300,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!batch.length) break;
    cursor = batch[batch.length - 1]!.id;
    for (const lead of batch) {
      checked++;
      const { rule, wh } = await c.prisma.$transaction(async (tx) => ({ rule: await getRule(tx, lead.organizationId, lead.teamId, 'UNATTENDED'), wh: await getWorkingHours(tx, lead.organizationId, lead.teamId) }));
      const perDay = workingMinutesPerDay(wh) || 600;
      const last = lead.lastActivityAt ?? lead.createdAt;
      const quiet = workingMinutesBetween(last, now, wh);
      let reason: LeadUnattendedPayload['reason'] | null = null;
      if (quiet >= rule.noActivityWorkingDays * perDay) reason = 'NO_ACTIVITY';
      else if (!lead.firstContactAt && lead.callAttemptCount === 0 && workingMinutesBetween(lead.assignedAt ?? lead.createdAt, now, wh) >= rule.newLeadFirstContactMinutes && lead.status === 'NEW') reason = 'NO_FIRST_CONTACT';
      if (!reason) continue;
      const manager = lead.assignedToId ? await ladder(c.prisma, lead.organizationId, lead.assignedToId, null) : null;
      const recipients = [...new Set([lead.assignedToId, manager].filter((x): x is string => !!x))];
      const window = `${reason}:${epoch(last)}`;
      const did = await c.prisma.$transaction(async (tx) => {
        const created = await raiseException(tx, d, lead, 'UNATTENDED', reason === 'NO_ACTIVITY' ? `No activity for ${rule.noActivityWorkingDays}+ working days` : 'New lead has not been contacted');
        const payload: LeadUnattendedPayload = { leadId: lead.id, assignedToId: lead.assignedToId, recipientIds: recipients, reason: reason!, window };
        const pub = await d.publish(tx, { eventType: CRM_EVENTS.LEAD_UNATTENDED, aggregateType: 'lead', aggregateId: lead.id, organizationId: lead.organizationId, payload: payload as unknown as Record<string, unknown>, idempotencyKey: `lead.unattended:${lead.id}:${window}` });
        return created || !!pub;
      });
      if (did) raised++;
    }
  }
  return { checked, raised };
}

/**
 * Ageing + invariant sweep: (1) heals drift of the "owner AND next action, or visible in the exception queue" invariant
 * (any OPEN lead missing either gets its exception row), (2) returns per-organization ageing histograms (since creation
 * and since last activity) used for monitoring.
 */
export async function scanAgeing(c: ScanContext): Promise<{ healed: number; histogram: Record<string, { creation: Record<string, number>; activity: Record<string, number> }> }> {
  const now = nowOf(c);
  const histogram: Record<string, { creation: Record<string, number>; activity: Record<string, number> }> = {};
  let healed = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch: Lead[] = await c.prisma.lead.findMany({ where: { stageCategory: 'OPEN', mergedIntoId: null }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!batch.length) break;
    cursor = batch[batch.length - 1]!.id;
    for (const l of batch) {
      const h = (histogram[l.organizationId] ??= { creation: Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])), activity: Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) });
      const a = leadAgeing(l, now);
      h.creation[a.creationBucket]!++;
      h.activity[a.activityBucket]!++;
    }
    const missing = batch.filter((l) => !l.assignedToId || !l.nextActionAt);
    for (const l of missing) {
      const open = await c.prisma.leadException.count({ where: { leadId: l.id, resolvedAt: null, kind: { in: ['NO_OWNER', 'NO_NEXT_ACTION'] } } });
      if (open === 0) {
        await c.prisma.$transaction((tx: Tx) => syncLeadExceptions(tx, l.id));
        healed++;
      }
    }
  }
  return { healed, histogram };
}

/** DEC-031: lost leads whose waiting period elapsed move LOST -> NURTURE (system) and become eligible in the queue. */
export async function scanReactivation(c: ScanContext): Promise<{ eligible: number; excluded: number }> {
  const now = nowOf(c);
  const d = deps(c);
  const due = await c.prisma.reactivationEntry.findMany({ where: { status: 'PENDING', openKey: { not: null }, eligibleFrom: { lte: now } }, include: { lead: true }, take: 500, orderBy: { eligibleFrom: 'asc' } });
  let eligible = 0;
  let excluded = 0;
  for (const e of due) {
    await c.prisma.$transaction(async (tx) => {
      const fresh = await tx.reactivationEntry.findFirst({ where: { id: e.id, status: 'PENDING' } });
      if (!fresh) return;
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: e.leadId } });
      if (lead.stageCategory !== 'LOST' || lead.consentStatus === 'WITHDRAWN' || lead.consentStatus === 'DND') {
        await tx.reactivationEntry.update({ where: { id: e.id }, data: { status: 'EXCLUDED', openKey: null, resolvedAt: now, outcome: lead.stageCategory !== 'LOST' ? 'NOT_LOST' : 'CONSENT' } });
        excluded++;
        return;
      }
      const stages = await loadStages(tx, lead.organizationId);
      const nurture = stages.find((s) => s.category === 'NURTURE');
      if (nurture) await transitionLeadTx(tx, d, { lead, stages, toKey: nurture.key, actorId: null, source: 'SYSTEM', reason: 'Reactivation rule matched', system: true });
      await tx.reactivationEntry.update({ where: { id: e.id }, data: { status: 'ELIGIBLE' } });
      eligible++;
    });
  }
  return { eligible, excluded };
}
