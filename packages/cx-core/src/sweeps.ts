import type { PrismaClient } from '@prisma/client';
import { CX_EVENTS } from '@salesos/shared-types';
import { auditSystem, emitCx, loadCxConfig, logState } from './db';
import { breachLevelAt, detectBreaches } from './sla';
import { findRule, HANDOVER_RULES, WORK_RULES, COMPLAINT_RULES } from './machines';
import { lastCompletedPeriod, reportDueAt, type ReportType } from './report';
import type { ComplaintPriorityKey } from './constants';
import type { CxConfig } from './config';
import type { WorkingHours } from '@salesos/crm-core';

const HOUR = 3_600_000;
const MIN = 60_000;

type ConfigCache = Map<string, Promise<{ cfg: CxConfig; wh: WorkingHours }>>;
const cfgOf = (prisma: PrismaClient, cache: ConfigCache, orgId: string) => {
  let p = cache.get(orgId);
  if (!p) {
    p = loadCxConfig(prisma, orgId);
    cache.set(orgId, p);
  }
  return p;
};

export interface SweepResult {
  job: string;
  changed: number;
  details: Record<string, number>;
}

// ---------------------------------------------------------------------------------------------- complaints

/**
 * Complaint SLA breach detection + escalation chain (DEC-017) + auto-close of RESOLVED complaints.
 * Idempotent and safe under concurrent workers: every state change is a compare-and-set (`updateMany` with the expected
 * previous value) and every notification event has a deterministic idempotency key.
 * Breach instant = the SLA due time (not the time the sweep noticed it). Level 1 owner, 2 team lead, 3 founder.
 */
export async function sweepComplaintSla(prisma: PrismaClient, now: Date = new Date()): Promise<SweepResult> {
  const cache: ConfigCache = new Map();
  const details = { firstResponseBreaches: 0, resolutionBreaches: 0, escalations: 0, autoClosed: 0 };

  const candidates = await prisma.complaint.findMany({
    where: { status: { in: ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'ESCALATED', 'REOPENED'] }, OR: [{ firstResponseDueAt: { lt: now } }, { resolutionDueAt: { lt: now } }] },
    orderBy: [{ resolutionDueAt: 'asc' }, { id: 'asc' }],
    take: 1000,
  });

  for (const c of candidates) {
    const { cfg } = await cfgOf(prisma, cache, c.organizationId);
    const clock = c.slaStartedAt.getTime();
    const payloadBase = (level: number, breach: 'FIRST_RESPONSE' | 'RESOLUTION') => ({
      organizationId: c.organizationId,
      complaintId: c.id,
      status: c.status,
      priority: c.priority,
      ownerId: c.ownerId,
      leadId: c.leadId,
      breach,
      level,
    });
    const recipients = (level: number): { notifyUserIds?: string[]; notifyRoles?: string[] } =>
      level === 1 ? { notifyUserIds: [c.ownerId] } : level === 2 ? { notifyRoles: ['SALES_TEAM_LEAD'] } : { notifyRoles: ['FOUNDER_CEO'] };

    let breachLevel = c.breachLevel;
    const breaches = detectBreaches(c, now);
    for (const b of breaches) {
      const at = b === 'FIRST_RESPONSE' ? c.firstResponseDueAt : c.resolutionDueAt;
      const res = await prisma.complaint.updateMany({
        where: { id: c.id, ...(b === 'FIRST_RESPONSE' ? { firstResponseBreachedAt: null } : { resolutionBreachedAt: null }) },
        data: b === 'FIRST_RESPONSE' ? { firstResponseBreachedAt: at } : { resolutionBreachedAt: at },
      });
      if (res.count === 1) {
        if (b === 'FIRST_RESPONSE') details.firstResponseBreaches += 1;
        else details.resolutionBreaches += 1;
        await auditSystem(prisma, { organizationId: c.organizationId, action: 'complaint.sla_breached', entityType: 'complaint', entityId: c.id, metadata: { breach: b, priority: c.priority } });
        await logState(prisma, { organizationId: c.organizationId, entityType: 'complaint', entityId: c.id, from: c.status, to: c.status, note: `SLA breach: ${b}`, metadata: { breach: b } });
      }
    }

    // escalation chain measured from the earliest still-relevant breach instant
    const frActive = !c.acknowledgedAt;
    const instants = [frActive && c.firstResponseDueAt.getTime() < now.getTime() ? c.firstResponseDueAt.getTime() : null, c.resolutionDueAt.getTime() < now.getTime() ? c.resolutionDueAt.getTime() : null].filter((v): v is number => v !== null);
    if (instants.length === 0) continue;
    const since = Math.floor((now.getTime() - Math.min(...instants)) / MIN);
    const target = breachLevelAt(since, c.priority as ComplaintPriorityKey, cfg);
    const kind: 'FIRST_RESPONSE' | 'RESOLUTION' = frActive && c.firstResponseDueAt.getTime() < now.getTime() ? 'FIRST_RESPONSE' : 'RESOLUTION';
    for (let level = breachLevel + 1; level <= target; level++) {
      const claim = await prisma.complaint.updateMany({ where: { id: c.id, breachLevel: level - 1 }, data: { breachLevel: level } });
      if (claim.count !== 1) break;
      breachLevel = level;
      details.escalations += 1;
      await emitCx(prisma, {
        organizationId: c.organizationId,
        eventType: CX_EVENTS.COMPLAINT_SLA_BREACHED,
        aggregateType: 'complaint',
        aggregateId: c.id,
        payload: { ...payloadBase(level, kind), ...recipients(level) },
        key: `complaint.sla_breached:${c.id}:${clock}:${level}`,
      });
    }
  }

  // RESOLVED -> CLOSED after N days (system)
  const rule = findRule(COMPLAINT_RULES, 'RESOLVED', 'CLOSED');
  const resolved = await prisma.complaint.findMany({ where: { status: 'RESOLVED', resolvedAt: { not: null } }, take: 1000, orderBy: { resolvedAt: 'asc' } });
  for (const c of resolved) {
    const { cfg } = await cfgOf(prisma, cache, c.organizationId);
    if (!c.resolvedAt || now.getTime() - c.resolvedAt.getTime() < cfg.autoCloseResolvedDays * 24 * HOUR || !rule?.actors.includes('SYSTEM')) continue;
    const res = await prisma.complaint.updateMany({ where: { id: c.id, status: 'RESOLVED' }, data: { status: 'CLOSED', closedAt: now, closeReason: `Auto-closed ${cfg.autoCloseResolvedDays} days after resolution`, version: { increment: 1 } } });
    if (res.count === 1) {
      details.autoClosed += 1;
      await logState(prisma, { organizationId: c.organizationId, entityType: 'complaint', entityId: c.id, from: 'RESOLVED', to: 'CLOSED', note: 'auto-closed (no reopen)' });
      await auditSystem(prisma, { organizationId: c.organizationId, action: 'complaint.closed', entityType: 'complaint', entityId: c.id, metadata: { auto: true } });
      await emitCx(prisma, { organizationId: c.organizationId, eventType: CX_EVENTS.COMPLAINT_CLOSED, aggregateType: 'complaint', aggregateId: c.id, payload: { organizationId: c.organizationId, complaintId: c.id, status: 'CLOSED', priority: c.priority, ownerId: c.ownerId, leadId: c.leadId, notifyUserIds: [c.ownerId] }, key: `complaint.closed:${c.id}:auto:${c.slaStartedAt.getTime()}` });
    }
  }

  return { job: 'complaint-sla', changed: details.firstResponseBreaches + details.resolutionBreaches + details.escalations + details.autoClosed, details };
}

// ---------------------------------------------------------------------------------------------- handovers

/** SUBMITTED handovers not acknowledged within the timer become OVERDUE (manager + Student Success alerted), then the team lead. */
export async function sweepHandovers(prisma: PrismaClient, now: Date = new Date()): Promise<SweepResult> {
  const cache: ConfigCache = new Map();
  const details = { overdue: 0, teamLeadAlerts: 0 };
  const rule = findRule(HANDOVER_RULES, 'SUBMITTED', 'OVERDUE');
  if (!rule?.actors.includes('SYSTEM')) throw new Error('handover machine lost its SUBMITTED->OVERDUE system rule');

  const due = await prisma.handoverRecord.findMany({ where: { status: 'SUBMITTED', ackDueAt: { lt: now } }, take: 1000, orderBy: { ackDueAt: 'asc' } });
  for (const h of due) {
    const res = await prisma.handoverRecord.updateMany({ where: { id: h.id, status: 'SUBMITTED' }, data: { status: 'OVERDUE', overdueAt: h.ackDueAt ?? now, overdueLevel: 1, version: { increment: 1 } } });
    if (res.count !== 1) continue;
    details.overdue += 1;
    const owner = await prisma.user.findFirst({ where: { id: h.ownerId, organizationId: h.organizationId }, select: { managerId: true } });
    const notifyUserIds = [h.ownerId, ...(owner?.managerId ? [owner.managerId] : [])];
    await logState(prisma, { organizationId: h.organizationId, entityType: 'handover', entityId: h.id, from: 'SUBMITTED', to: 'OVERDUE', note: 'not acknowledged within the alert timer' });
    await auditSystem(prisma, { organizationId: h.organizationId, action: 'handover.overdue', entityType: 'handover', entityId: h.id });
    await emitCx(prisma, { organizationId: h.organizationId, eventType: CX_EVENTS.HANDOVER_OVERDUE, aggregateType: 'handover', aggregateId: h.id, payload: { organizationId: h.organizationId, handoverId: h.id, status: 'OVERDUE', ownerId: h.ownerId, dealId: h.dealId, leadId: h.leadId, level: 1, notifyUserIds, notifyRoles: ['STUDENT_SUCCESS'] }, key: `handover.overdue:${h.id}:1` });
  }

  const overdue = await prisma.handoverRecord.findMany({ where: { status: 'OVERDUE', overdueLevel: 1, ackDueAt: { not: null } }, take: 1000 });
  for (const h of overdue) {
    const { cfg } = await cfgOf(prisma, cache, h.organizationId);
    if (!h.ackDueAt || now.getTime() < h.ackDueAt.getTime() + cfg.handover.teamLeadAfterHours * HOUR) continue;
    const res = await prisma.handoverRecord.updateMany({ where: { id: h.id, status: 'OVERDUE', overdueLevel: 1 }, data: { overdueLevel: 2 } });
    if (res.count !== 1) continue;
    details.teamLeadAlerts += 1;
    await emitCx(prisma, { organizationId: h.organizationId, eventType: CX_EVENTS.HANDOVER_OVERDUE, aggregateType: 'handover', aggregateId: h.id, payload: { organizationId: h.organizationId, handoverId: h.id, status: 'OVERDUE', ownerId: h.ownerId, dealId: h.dealId, leadId: h.leadId, level: 2, notifyRoles: ['SALES_TEAM_LEAD', 'STUDENT_SUCCESS'] }, key: `handover.overdue:${h.id}:2` });
  }
  return { job: 'handover-overdue', changed: details.overdue + details.teamLeadAlerts, details };
}

// ---------------------------------------------------------------------------------------------- action items + xf tasks

/** OPEN/IN_PROGRESS past due -> OVERDUE (owner alerted); OVERDUE for N hours -> ESCALATED (Founder for action items, manager/TL for xf tasks). */
export async function sweepWorkItems(prisma: PrismaClient, now: Date = new Date()): Promise<SweepResult> {
  const cache: ConfigCache = new Map();
  const details = { actionItemsOverdue: 0, actionItemsEscalated: 0, xfOverdue: 0, xfEscalated: 0 };
  if (!findRule(WORK_RULES, 'OPEN', 'OVERDUE')?.actors.includes('SYSTEM') || !findRule(WORK_RULES, 'OVERDUE', 'ESCALATED')?.actors.includes('SYSTEM')) throw new Error('work-item machine lost its system rules');

  // ---- action items
  const aiDue = await prisma.actionItem.findMany({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: now } }, take: 1000, orderBy: { dueAt: 'asc' } });
  for (const a of aiDue) {
    const res = await prisma.actionItem.updateMany({ where: { id: a.id, status: { in: ['OPEN', 'IN_PROGRESS'] } }, data: { status: 'OVERDUE', overdueLevel: 1, version: { increment: 1 } } });
    if (res.count !== 1) continue;
    details.actionItemsOverdue += 1;
    await logState(prisma, { organizationId: a.organizationId, entityType: 'action_item', entityId: a.id, from: a.status, to: 'OVERDUE', note: 'past due date' });
    await auditSystem(prisma, { organizationId: a.organizationId, action: 'action_item.overdue', entityType: 'action_item', entityId: a.id });
    await emitCx(prisma, { organizationId: a.organizationId, eventType: CX_EVENTS.ACTION_ITEM_OVERDUE, aggregateType: 'action_item', aggregateId: a.id, payload: { organizationId: a.organizationId, actionItemId: a.id, status: 'OVERDUE', ownerId: a.ownerId, dueAt: a.dueAt.toISOString(), level: 1, notifyUserIds: [a.ownerId] }, key: `action_item.overdue:${a.id}:1` });
  }
  const aiOverdue = await prisma.actionItem.findMany({ where: { status: 'OVERDUE' }, take: 1000 });
  for (const a of aiOverdue) {
    const { cfg } = await cfgOf(prisma, cache, a.organizationId);
    if (now.getTime() < a.dueAt.getTime() + cfg.workItems.escalateAfterHours * HOUR) continue;
    const res = await prisma.actionItem.updateMany({ where: { id: a.id, status: 'OVERDUE' }, data: { status: 'ESCALATED', overdueLevel: 2, escalatedAt: now, version: { increment: 1 } } });
    if (res.count !== 1) continue;
    details.actionItemsEscalated += 1;
    await logState(prisma, { organizationId: a.organizationId, entityType: 'action_item', entityId: a.id, from: 'OVERDUE', to: 'ESCALATED', note: 'overdue threshold reached' });
    await auditSystem(prisma, { organizationId: a.organizationId, action: 'action_item.escalated', entityType: 'action_item', entityId: a.id });
    await emitCx(prisma, { organizationId: a.organizationId, eventType: CX_EVENTS.ACTION_ITEM_ESCALATED, aggregateType: 'action_item', aggregateId: a.id, payload: { organizationId: a.organizationId, actionItemId: a.id, status: 'ESCALATED', ownerId: a.ownerId, dueAt: a.dueAt.toISOString(), level: 2, notifyUserIds: [a.ownerId], notifyRoles: ['FOUNDER_CEO'] }, key: `action_item.escalated:${a.id}` });
  }

  // ---- cross-functional tasks
  const xDue = await prisma.xfTask.findMany({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: now } }, take: 1000, orderBy: { dueAt: 'asc' } });
  for (const t of xDue) {
    const res = await prisma.xfTask.updateMany({ where: { id: t.id, status: { in: ['OPEN', 'IN_PROGRESS'] } }, data: { status: 'OVERDUE', overdueLevel: 1, version: { increment: 1 } } });
    if (res.count !== 1) continue;
    details.xfOverdue += 1;
    await logState(prisma, { organizationId: t.organizationId, entityType: 'xf_task', entityId: t.id, from: t.status, to: 'OVERDUE', note: 'past due date' });
    await auditSystem(prisma, { organizationId: t.organizationId, action: 'xf_task.overdue', entityType: 'xf_task', entityId: t.id });
    await emitCx(prisma, { organizationId: t.organizationId, eventType: CX_EVENTS.XF_TASK_OVERDUE, aggregateType: 'xf_task', aggregateId: t.id, payload: { organizationId: t.organizationId, taskId: t.id, status: 'OVERDUE', ownerId: t.ownerId, department: t.department, dueAt: t.dueAt.toISOString(), level: 1, notifyUserIds: [t.ownerId, t.requesterId] }, key: `xf_task.overdue:${t.id}:1` });
  }
  const xOverdue = await prisma.xfTask.findMany({ where: { status: 'OVERDUE' }, take: 1000 });
  for (const t of xOverdue) {
    const { cfg } = await cfgOf(prisma, cache, t.organizationId);
    if (now.getTime() < t.dueAt.getTime() + cfg.workItems.escalateAfterHours * HOUR) continue;
    const res = await prisma.xfTask.updateMany({ where: { id: t.id, status: 'OVERDUE' }, data: { status: 'ESCALATED', overdueLevel: 2, escalatedAt: now, version: { increment: 1 } } });
    if (res.count !== 1) continue;
    details.xfEscalated += 1;
    const owner = await prisma.user.findFirst({ where: { id: t.ownerId, organizationId: t.organizationId }, select: { managerId: true } });
    await logState(prisma, { organizationId: t.organizationId, entityType: 'xf_task', entityId: t.id, from: 'OVERDUE', to: 'ESCALATED', note: 'overdue threshold reached' });
    await auditSystem(prisma, { organizationId: t.organizationId, action: 'xf_task.escalated', entityType: 'xf_task', entityId: t.id });
    await emitCx(prisma, { organizationId: t.organizationId, eventType: CX_EVENTS.XF_TASK_ESCALATED, aggregateType: 'xf_task', aggregateId: t.id, payload: { organizationId: t.organizationId, taskId: t.id, status: 'ESCALATED', ownerId: t.ownerId, department: t.department, dueAt: t.dueAt.toISOString(), level: 2, notifyUserIds: [t.requesterId, ...(owner?.managerId ? [owner.managerId] : [])], notifyRoles: ['SALES_TEAM_LEAD'] }, key: `xf_task.escalated:${t.id}` });
  }
  return { job: 'work-items', changed: Object.values(details).reduce((a, b) => a + b, 0), details };
}

// ---------------------------------------------------------------------------------------------- founder reports

/**
 * (1) Creates the DRAFT shell for the most recent completed weekly + monthly period (so a report that nobody started is
 * still "due" and counts in the timeliness denominator), authored by the org's first active Team Lead.
 * (2) Reminds the author when a draft is overdue, then the Founder after the configured delay.
 */
export async function sweepFounderReports(prisma: PrismaClient, now: Date = new Date()): Promise<SweepResult> {
  const cache: ConfigCache = new Map();
  const details = { shellsCreated: 0, dueSoon: 0, authorReminders: 0, founderAlerts: 0 };

  const tlRole = await prisma.role.findUnique({ where: { key: 'SALES_TEAM_LEAD' } });
  if (tlRole) {
    const assignments = await prisma.userRoleAssignment.findMany({ where: { roleId: tlRole.id, user: { isActive: true } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { organizationId: true, userId: true } });
    const authorByOrg = new Map<string, string>();
    for (const a of assignments) if (!authorByOrg.has(a.organizationId)) authorByOrg.set(a.organizationId, a.userId);
    for (const [orgId, authorId] of authorByOrg) {
      const { cfg, wh } = await cfgOf(prisma, cache, orgId);
      for (const type of ['WEEKLY', 'MONTHLY'] as ReportType[]) {
        const period = lastCompletedPeriod(type, now, cfg.reports.timezone);
        const periodStart = new Date(`${period.start}T00:00:00.000Z`);
        const exists = await prisma.founderReport.findFirst({ where: { organizationId: orgId, type, periodStart } });
        if (exists) continue;
        const res = await prisma.founderReport.createMany({
          data: [{ organizationId: orgId, type, periodStart, periodEnd: new Date(`${period.end}T00:00:00.000Z`), authorId, title: `${type === 'WEEKLY' ? 'Weekly' : 'Monthly'} Founder report ${period.start} to ${period.end}`, sections: {}, dueAt: reportDueAt(type, period.end, cfg, wh) }],
          skipDuplicates: true,
        });
        details.shellsCreated += res.count;
      }
    }
  }

  const drafts = await prisma.founderReport.findMany({ where: { status: 'DRAFT' }, take: 1000, orderBy: { dueAt: 'asc' } });
  for (const r of drafts) {
    const { cfg } = await cfgOf(prisma, cache, r.organizationId);
    const base = { organizationId: r.organizationId, reportId: r.id, type: r.type, periodStart: r.periodStart.toISOString().slice(0, 10), dueAt: r.dueAt.toISOString() };
    if (r.dueAt.getTime() > now.getTime()) {
      if (r.dueAt.getTime() - now.getTime() <= 24 * HOUR) {
        const ok = await emitCx(prisma, { organizationId: r.organizationId, eventType: CX_EVENTS.FOUNDER_REPORT_DUE, aggregateType: 'founder_report', aggregateId: r.id, payload: { ...base, notifyUserIds: [r.authorId] }, key: `founder_report.due:${r.id}` });
        if (ok) details.dueSoon += 1;
      }
      continue;
    }
    if (r.dueReminderLevel === 0) {
      const res = await prisma.founderReport.updateMany({ where: { id: r.id, status: 'DRAFT', dueReminderLevel: 0 }, data: { dueReminderLevel: 1 } });
      if (res.count === 1) {
        details.authorReminders += 1;
        await emitCx(prisma, { organizationId: r.organizationId, eventType: CX_EVENTS.FOUNDER_REPORT_OVERDUE, aggregateType: 'founder_report', aggregateId: r.id, payload: { ...base, level: 1, notifyUserIds: [r.authorId] }, key: `founder_report.overdue:${r.id}:1` });
      }
    } else if (r.dueReminderLevel === 1 && now.getTime() >= r.dueAt.getTime() + cfg.reports.founderAlertAfterHours * HOUR) {
      const res = await prisma.founderReport.updateMany({ where: { id: r.id, status: 'DRAFT', dueReminderLevel: 1 }, data: { dueReminderLevel: 2 } });
      if (res.count === 1) {
        details.founderAlerts += 1;
        await emitCx(prisma, { organizationId: r.organizationId, eventType: CX_EVENTS.FOUNDER_REPORT_OVERDUE, aggregateType: 'founder_report', aggregateId: r.id, payload: { ...base, level: 2, notifyRoles: ['FOUNDER_CEO'] }, key: `founder_report.overdue:${r.id}:2` });
      }
    }
  }
  return { job: 'founder-reports', changed: details.shellsCreated + details.authorReminders + details.founderAlerts + details.dueSoon, details };
}

export async function runAllCxSweeps(prisma: PrismaClient, now: Date = new Date()): Promise<SweepResult[]> {
  return [await sweepComplaintSla(prisma, now), await sweepHandovers(prisma, now), await sweepWorkItems(prisma, now), await sweepFounderReports(prisma, now)];
}
