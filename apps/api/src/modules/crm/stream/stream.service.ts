import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Principal } from '../../../common/authz';
import { CrmSupport } from '../crm.support';

export const OVERLAP_MS = 5000;

/** Platform notification types raised for CRM facts (see CRM_KIND_TO_TYPE in platform-core). */
export const CRM_NOTIFICATION_WHERE = { OR: [{ type: { startsWith: 'follow_up.' } }, { type: { startsWith: 'lead.' } }] } satisfies Prisma.NotificationWhereInput;

export interface StreamEvent {
  type: 'task' | 'notification' | 'exceptions';
  data: Record<string, unknown>;
}

/**
 * Change feed shared by the SSE stream and the polling fallback. EVERY query is built from the principal's own
 * permissions + scope (scopedWhere), so a client can never receive events for records it cannot read.
 */
@Injectable()
export class StreamService {
  constructor(private readonly s: CrmSupport) {}

  /**
   * `since` is a cursor from a previous call. The query looks back OVERLAP_MS because a row's updated_at is stamped when the
   * statement runs but becomes visible only on commit; consumers de-duplicate by (id, version / updatedAt).
   */
  async collect(user: Principal, since: Date): Promise<{ cursor: string; events: StreamEvent[] }> {
    const cursor = new Date();
    const from = new Date(since.getTime() - OVERLAP_MS);
    const events: StreamEvent[] = [];
    if (this.s.access.has(user, 'tasks:view')) {
      const scoped = await this.s.access.scopedWhere(user, { permission: 'tasks:view', ownerField: 'assignedToId', teamField: 'teamId' });
      const rows = await this.s.prisma.task.findMany({ where: { ...scoped, updatedAt: { gt: from } } as Prisma.TaskWhereInput, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 200 });
      for (const t of rows) events.push({ type: 'task', data: { id: t.id, leadId: t.leadId, assignedToId: t.assignedToId, title: t.title, type: t.type, status: t.status, dueAt: t.dueAt.toISOString(), overdue: t.status === 'OPEN' && t.dueAt < cursor, priority: t.priority, version: t.version, updatedAt: t.updatedAt.toISOString() } });
    }
    const notes = await this.s.prisma.notification.findMany({ where: { ...CRM_NOTIFICATION_WHERE, organizationId: user.organizationId, userId: user.userId, lastRaisedAt: { gt: from } }, orderBy: [{ lastRaisedAt: 'asc' }, { id: 'asc' }], take: 100 });
    for (const n of notes) events.push({ type: 'notification', data: { id: n.id, kind: n.type, title: n.title, body: n.body, severity: n.severity.toLowerCase(), entityType: n.entityType, entityId: n.entityId, status: n.status, createdAt: n.lastRaisedAt.toISOString() } });
    if (this.s.access.has(user, 'leads:exceptions:view')) {
      events.push({ type: 'exceptions', data: { openCount: await this.exceptionCount(user) } });
    }
    return { cursor: cursor.toISOString(), events };
  }

  async exceptionCount(user: Principal): Promise<number> {
    const scoped = await this.s.access.scopedWhere(user, { permission: 'leads:exceptions:view', ownerField: 'assignedToId', teamField: 'teamId' });
    return this.s.prisma.leadException.count({ where: { organizationId: user.organizationId, resolvedAt: null, lead: { ...scoped, mergedIntoId: null } as Prisma.LeadWhereInput } });
  }

  /**
   * Thin view over the platform notification store (KI-F-04): the CRM keeps no inbox of its own any more. Only the CRM
   * notification types (follow-ups, lead alerts) are shown here; the bell shows everything.
   */
  async notifications(user: Principal, limit = 30) {
    const where = { ...CRM_NOTIFICATION_WHERE, organizationId: user.organizationId, userId: user.userId };
    const rows = await this.s.prisma.notification.findMany({ where, orderBy: [{ lastRaisedAt: 'desc' }, { id: 'desc' }], take: Math.min(limit, 100) });
    const unread = await this.s.prisma.notification.count({ where: { ...where, readAt: null, dismissedAt: null } });
    return { unread, items: rows.map((n) => ({ id: n.id, kind: n.type, title: n.title, body: n.body, severity: n.severity.toLowerCase(), entityType: n.entityType, entityId: n.entityId, status: n.status, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })) };
  }

  async markRead(user: Principal, id: string) {
    const res = await this.s.prisma.notification.updateMany({ where: { id, organizationId: user.organizationId, userId: user.userId, readAt: null }, data: { readAt: new Date(), status: 'READ' } });
    return { id, updated: res.count };
  }
}
