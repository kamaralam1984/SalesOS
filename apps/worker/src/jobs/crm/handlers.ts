import type { PrismaClient } from '@prisma/client';
import {
  CRM_EVENTS,
  IDENTITY_EVENTS,
  type DomainEvent,
  type ImportRequestedPayload,
  type LeadAssignedPayload,
  type LeadUnattendedPayload,
  type TaskNotifyPayload,
  type UserDeactivatedPayload,
} from '@salesos/shared-types';
import { directDeps, processImportJob, queueOwnerDeactivation } from '@salesos/crm-core';
import { enqueueNotification } from './notifications';

type Notify = (n: Parameters<typeof enqueueNotification>[1]) => ReturnType<typeof enqueueNotification>;

/**
 * Event handlers. All are idempotent: notification keys derive from stable event data (never event.id for time-window
 * notifications), so at-least-once outbox delivery and BullMQ retries cannot produce duplicate reminders.
 */
export function makeHandlers(prisma: PrismaClient, notify: Notify = (n) => enqueueNotification(prisma, n)) {
  const taskNotification = async (event: DomainEvent, kind: string, titlePrefix: string, severity: 'info' | 'warning' | 'critical') => {
    const p = event.payload as TaskNotifyPayload;
    const task = await prisma.task.findFirst({ where: { id: p.taskId, organizationId: event.organizationId ?? undefined } });
    if (!task || task.status !== 'OPEN') return; // completed / cancelled before the reminder fired: nothing to say
    if (task.dueAt.toISOString() !== p.dueAt) return; // rescheduled: a newer window owns the reminder
    const recipientId = p.recipientId ?? task.assignedToId;
    const lead = task.leadId ? await prisma.lead.findUnique({ where: { id: task.leadId }, select: { fullName: true } }) : null;
    const owner = p.recipientId && p.recipientId !== task.assignedToId ? await prisma.user.findUnique({ where: { id: task.assignedToId }, select: { name: true } }) : null;
    await notify({
      organizationId: task.organizationId,
      recipientId,
      kind,
      channel: 'IN_APP',
      title: `${titlePrefix}: ${task.title}`,
      body: [lead ? `Lead: ${lead.fullName}` : null, owner ? `Owner: ${owner.name}` : null, `Due ${task.dueAt.toISOString()}`].filter(Boolean).join(' | '),
      severity,
      entityType: 'task',
      entityId: task.id,
      data: { taskId: task.id, leadId: task.leadId, level: p.level ?? null },
      idempotencyKey: `${kind}:${task.id}:${p.window}:${recipientId}:IN_APP`,
    });
  };

  return {
    [CRM_EVENTS.TASK_DUE]: (e: DomainEvent) => taskNotification(e, 'task.due', 'Due now', 'info'),
    [CRM_EVENTS.TASK_REMINDER]: (e: DomainEvent) => taskNotification(e, 'task.reminder', 'Coming up', 'info'),
    [CRM_EVENTS.TASK_OVERDUE]: (e: DomainEvent) => taskNotification(e, 'task.overdue', 'Overdue', 'warning'),
    [CRM_EVENTS.TASK_ESCALATED]: (e: DomainEvent) => taskNotification(e, 'task.escalated', 'Escalation: overdue task', 'critical'),

    async [CRM_EVENTS.LEAD_UNATTENDED](e: DomainEvent) {
      const p = e.payload as LeadUnattendedPayload;
      const lead = await prisma.lead.findFirst({ where: { id: p.leadId, organizationId: e.organizationId ?? undefined, stageCategory: 'OPEN' }, select: { id: true, fullName: true, organizationId: true } });
      if (!lead) return;
      for (const recipientId of p.recipientIds) {
        await notify({
          organizationId: lead.organizationId,
          recipientId,
          kind: 'lead.unattended',
          channel: 'IN_APP',
          title: p.reason === 'NO_FIRST_CONTACT' ? `New lead not contacted: ${lead.fullName}` : `Unattended lead: ${lead.fullName}`,
          severity: 'warning',
          entityType: 'lead',
          entityId: lead.id,
          idempotencyKey: `lead.unattended:${lead.id}:${p.window}:${recipientId}:IN_APP`,
        });
      }
    },

    async [CRM_EVENTS.LEAD_ASSIGNED](e: DomainEvent) {
      const p = e.payload as LeadAssignedPayload;
      if (!p.toUserId || p.toUserId === p.changedById) return;
      const lead = await prisma.lead.findFirst({ where: { id: p.leadId, organizationId: e.organizationId ?? undefined }, select: { fullName: true, organizationId: true, assignedToId: true } });
      if (!lead || lead.assignedToId !== p.toUserId) return;
      await notify({ organizationId: lead.organizationId, recipientId: p.toUserId, kind: 'lead.assigned', channel: 'IN_APP', title: `New lead assigned: ${lead.fullName}`, severity: 'info', entityType: 'lead', entityId: p.leadId, idempotencyKey: `lead.assigned:${e.id}:${p.toUserId}:IN_APP` });
    },

    async [CRM_EVENTS.LEAD_EXCEPTION_RAISED](e: DomainEvent) {
      const p = e.payload as { leadId: string; kind: string; detail?: string };
      if (p.kind !== 'MANAGER_REVIEW') return;
      const lead = await prisma.lead.findFirst({ where: { id: p.leadId, organizationId: e.organizationId ?? undefined }, select: { fullName: true, organizationId: true, assignedToId: true, teamId: true } });
      if (!lead?.assignedToId) return;
      const owner = await prisma.user.findUnique({ where: { id: lead.assignedToId }, select: { managerId: true } });
      if (!owner?.managerId) return;
      await notify({ organizationId: lead.organizationId, recipientId: owner.managerId, kind: 'lead.exception', channel: 'IN_APP', title: `Manager review needed: ${lead.fullName}`, body: p.detail, severity: 'warning', entityType: 'lead', entityId: p.leadId, idempotencyKey: `lead.exception:${e.id}:${owner.managerId}:IN_APP` });
    },

    async [IDENTITY_EVENTS.USER_DEACTIVATED](e: DomainEvent) {
      const p = e.payload as UserDeactivatedPayload;
      const organizationId = p.organizationId ?? e.organizationId;
      if (!organizationId) return;
      const res = await queueOwnerDeactivation(prisma, directDeps(), { organizationId, userId: p.userId, eventId: e.id, managerId: p.managerId });
      if (p.managerId && (res.leads || res.tasks)) {
        await notify({ organizationId, recipientId: p.managerId, kind: 'reassignment.created', channel: 'IN_APP', title: `Reassignment needed: ${res.leads} lead(s), ${res.tasks} task(s)`, body: 'The owner was deactivated. Open the reassignment queue to assign them.', severity: 'warning', entityType: 'user', entityId: p.userId, idempotencyKey: `reassignment.created:${e.id}:${p.managerId}:IN_APP` });
      }
    },

    async [CRM_EVENTS.IMPORT_REQUESTED](e: DomainEvent) {
      const p = e.payload as ImportRequestedPayload;
      await processImportJob(prisma, directDeps(), p.jobId, { workerId: `evt-${e.id}` });
    },
  };
}
