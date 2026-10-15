import { Prisma, type PrismaClient } from '@prisma/client';
import { resolveCxConfig, toWorkingHours, type CxConfig } from './config';
import type { WorkingHours } from '@salesos/crm-core';

export type Db = PrismaClient | Prisma.TransactionClient;

export interface OutboxInput {
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  /** business idempotency key - the same key is stored once (at-least-once safe) */
  key: string;
}

/** Same row shape as OutboxService.publish (apps/api/src/common/outbox): the worker dispatcher relays PENDING rows. */
export async function emitOutbox(db: Db, e: OutboxInput): Promise<boolean> {
  const res = await db.outboxEvent.createMany({
    data: [{ organizationId: e.organizationId, eventType: e.eventType, aggregateType: e.aggregateType, aggregateId: e.aggregateId, payload: e.payload as Prisma.InputJsonValue, idempotencyKey: e.key }],
    skipDuplicates: true,
  });
  return res.count === 1;
}

export async function logState(
  db: Db,
  e: { organizationId: string; entityType: string; entityId: string; from: string | null; to: string; actorId?: string | null; note?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  await db.cxStateLog.create({
    data: {
      organizationId: e.organizationId,
      entityType: e.entityType,
      entityId: e.entityId,
      fromStatus: e.from,
      toStatus: e.to,
      actorId: e.actorId ?? null,
      actorKind: e.actorId ? 'USER' : 'SYSTEM',
      note: e.note ?? null,
      metadata: (e.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function auditSystem(db: Db, e: { organizationId: string; action: string; entityType: string; entityId: string; metadata?: Record<string, unknown> }): Promise<void> {
  await db.auditLog.create({
    data: { organizationId: e.organizationId, actorId: null, action: e.action, entityType: e.entityType, entityId: e.entityId, metadata: { system: true, ...(e.metadata ?? {}) } as Prisma.InputJsonValue },
  });
}

/** Stored CX settings merged over the defaults (+ the org's business timezone for working hours). */
export async function loadCxConfig(db: Db, organizationId: string): Promise<{ cfg: CxConfig; wh: WorkingHours }> {
  const [row, org] = await Promise.all([
    db.cxSetting.findUnique({ where: { organizationId } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
  ]);
  const cfg = resolveCxConfig(row?.config);
  const tz = (org?.settings as { businessTimezone?: string } | null)?.businessTimezone;
  return { cfg, wh: toWorkingHours(cfg, tz) };
}

// ---------------------------------------------------------------------------------------------- notifications

type NotifyType =
  | 'complaint.created' | 'complaint.updated' | 'complaint.escalated' | 'handover.update' | 'founder.action_item'
  | 'follow_up.due' | 'follow_up.overdue' | 'follow_up.escalated' | 'review.pending';

interface NotifyMapping {
  type: NotifyType;
  title: string;
  url: (aggregateId: string) => string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
}

/**
 * Domain events the platform notifier (Agent F, worker jobs/platform/events.ts) does NOT map by itself. For these `emitCx`
 * also publishes the generic `notification.requested` contract (docs/platform-report.md 1.1, way 2) so the alert is raised
 * without the platform knowing CX. Events the platform already maps (complaint.created|escalated|acknowledged|resolved,
 * handover.submitted|overdue|acknowledged|completed|info_requested) are NOT duplicated here.
 */
export const CX_NOTIFY_MAP: Record<string, NotifyMapping> = {
  'complaint.sla_breached': { type: 'complaint.escalated', title: 'Complaint SLA breached', url: (id) => `/cx/complaints/${id}`, severity: 'CRITICAL' },
  'complaint.closed': { type: 'complaint.updated', title: 'Complaint closed', url: (id) => `/cx/complaints/${id}` },
  'complaint.reopened': { type: 'complaint.updated', title: 'Complaint reopened', url: (id) => `/cx/complaints/${id}`, severity: 'WARNING' },
  'complaint.updated': { type: 'complaint.updated', title: 'Complaint updated', url: (id) => `/cx/complaints/${id}` },
  'escalation.raised': { type: 'complaint.escalated', title: 'Conversation escalated for help', url: (id) => `/cx/escalations?focus=${id}`, severity: 'WARNING' },
  'escalation.updated': { type: 'complaint.updated', title: 'Escalation updated', url: (id) => `/cx/escalations?focus=${id}` },
  'handover.created': { type: 'handover.update', title: 'A handover draft is ready to complete', url: (id) => `/cx/handovers/${id}` },
  'action_item.created': { type: 'founder.action_item', title: 'New action item assigned to you', url: (id) => `/cx/action-items?focus=${id}` },
  'action_item.completed': { type: 'founder.action_item', title: 'Action item completed', url: (id) => `/cx/action-items?focus=${id}` },
  'action_item.overdue': { type: 'founder.action_item', title: 'Action item overdue', url: (id) => `/cx/action-items?focus=${id}`, severity: 'WARNING' },
  'action_item.escalated': { type: 'founder.action_item', title: 'Action item overdue and escalated', url: (id) => `/cx/action-items?focus=${id}`, severity: 'CRITICAL' },
  'xf_task.created': { type: 'follow_up.due', title: 'New cross-functional task', url: (id) => `/collaboration?focus=${id}` },
  'xf_task.updated': { type: 'follow_up.due', title: 'Cross-functional task updated', url: (id) => `/collaboration?focus=${id}` },
  'xf_task.completed': { type: 'follow_up.due', title: 'Task completed, please confirm', url: (id) => `/collaboration?focus=${id}` },
  'xf_task.confirmed': { type: 'follow_up.due', title: 'Task completion confirmed', url: (id) => `/collaboration?focus=${id}` },
  'xf_task.overdue': { type: 'follow_up.overdue', title: 'Cross-functional task overdue', url: (id) => `/collaboration?focus=${id}`, severity: 'WARNING' },
  'xf_task.escalated': { type: 'follow_up.escalated', title: 'Cross-functional task escalated', url: (id) => `/collaboration?focus=${id}`, severity: 'CRITICAL' },
  'founder_report.published': { type: 'founder.action_item', title: 'Founder report published', url: (id) => `/cx/founder-reports/${id}` },
  'founder_report.due': { type: 'review.pending', title: 'Founder report due soon', url: (id) => `/cx/founder-reports/${id}` },
  'founder_report.overdue': { type: 'review.pending', title: 'Founder report overdue', url: (id) => `/cx/founder-reports/${id}`, severity: 'CRITICAL' },
};

/**
 * Publish a CX domain event and, when the platform does not map it itself, the generic notification request.
 * Payload recipients: `notifyUserIds` / `notifyRoles`. Both rows are idempotent (keys derive from `key`).
 */
export async function emitCx(db: Db, e: OutboxInput): Promise<boolean> {
  const first = await emitOutbox(db, e);
  const m = CX_NOTIFY_MAP[e.eventType];
  const p = e.payload as { notifyUserIds?: string[]; notifyRoles?: string[]; level?: number };
  if (m && ((p.notifyUserIds?.length ?? 0) > 0 || (p.notifyRoles?.length ?? 0) > 0)) {
    await emitOutbox(db, {
      organizationId: e.organizationId,
      eventType: 'notification.requested',
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      key: `notif:${e.key}`.slice(0, 190),
      payload: {
        organizationId: e.organizationId,
        type: m.type,
        ...(p.notifyUserIds?.length ? { userIds: p.notifyUserIds } : {}),
        ...(p.notifyRoles?.length ? { roles: p.notifyRoles } : {}),
        entity: { type: e.aggregateType, id: e.aggregateId },
        dedupeKey: `${e.key}`.slice(0, 190),
        title: m.title,
        severity: m.severity,
        actionUrl: m.url(e.aggregateId),
      },
    });
  }
  return first;
}
