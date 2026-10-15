import type { CrmNotification, NotificationPort, NotificationResult, NotificationTypeKey } from '@salesos/shared-types';
import type { PrismaClient } from '@prisma/client';
import { notify } from './notifications/notify';

/** CRM kinds (events/crm.ts) -> platform notification type catalogue. */
export const CRM_KIND_TO_TYPE: Record<string, NotificationTypeKey> = {
  'task.due': 'follow_up.due',
  'task.reminder': 'follow_up.due',
  'task.overdue': 'follow_up.overdue',
  'task.escalated': 'follow_up.escalated',
  'lead.unattended': 'lead.no_next_action',
  'lead.exception_raised': 'lead.exception',
  'lead.unassigned': 'lead.unassigned',
  'lead.assigned': 'lead.assigned',
  'reassignment.created': 'reassignment.needed',
};

function actionUrl(n: CrmNotification): string | undefined {
  const leadId = typeof n.data?.leadId === 'string' ? n.data.leadId : undefined;
  if (leadId && /^[0-9a-f-]{36}$/i.test(leadId)) return `/crm/leads/${leadId}`;
  if (n.entityType === 'lead' && n.entityId) return `/crm/leads/${n.entityId}`;
  if (n.entityType === 'task') return `/crm/tasks`;
  return undefined;
}

/**
 * Implements the CRM's `NotificationPort` on the platform notifier (dedupe, preferences, quiet hours, channels).
 * IN_APP: the notification row IS the delivery (DELIVERED = stored in the user's inbox). EMAIL/WHATSAPP: queued for the
 * provider adapters (QUEUED/SENT until a provider callback; never DELIVERED here). PUSH has no adapter -> FAILED.
 */
export function createCrmNotificationPort(prisma: PrismaClient): NotificationPort {
  return {
    async send(n: CrmNotification): Promise<NotificationResult> {
      const type = CRM_KIND_TO_TYPE[n.kind];
      if (!type) return { status: 'FAILED', errorCode: 'UNMAPPED_KIND' };
      if (n.channel === 'PUSH') return { status: 'FAILED', errorCode: 'NO_PUSH_ADAPTER' };
      const res = await notify(prisma, {
        organizationId: n.organizationId, type, userId: n.recipientId, dedupeKey: n.idempotencyKey,
        entity: n.entityType && n.entityId ? { type: n.entityType, id: n.entityId } : undefined,
        channel: n.channel === 'IN_APP' ? ['IN_APP'] : ['IN_APP', n.channel],
        severity: n.severity === 'critical' ? 'CRITICAL' : n.severity === 'warning' ? 'WARNING' : n.severity === 'info' ? 'INFO' : undefined,
        title: n.title, body: n.body, actionUrl: actionUrl(n), payload: n.data,
      });
      const duplicate = res.deduplicated > 0 && res.created === 0;
      if (n.channel === 'IN_APP') return { status: res.created + res.deduplicated + res.digested > 0 ? 'DELIVERED' : 'FAILED', duplicate, ...(res.created + res.deduplicated + res.digested === 0 ? { errorCode: 'SUPPRESSED' } : {}) };
      return { status: 'QUEUED', duplicate };
    },
  };
}
