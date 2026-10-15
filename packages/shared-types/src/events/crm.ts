// Owned by the crm agent. Event-type constants + payload interfaces + the NotificationPort contract.

export const CRM_EVENTS = {
  LEAD_CREATED: 'lead.created',
  LEAD_ASSIGNED: 'lead.assigned',
  LEAD_STATUS_CHANGED: 'lead.status_changed',
  LEAD_WON: 'lead.won',
  LEAD_LOST: 'lead.lost',
  LEAD_UNATTENDED: 'lead.unattended',
  LEAD_EXCEPTION_RAISED: 'lead.exception_raised',
  LEAD_MERGED: 'lead.merged',
  CALL_LOGGED: 'call.logged',
  TASK_CREATED: 'task.created',
  TASK_COMPLETED: 'task.completed',
  TASK_DUE: 'task.due',
  TASK_REMINDER: 'task.reminder',
  TASK_OVERDUE: 'task.overdue',
  TASK_ESCALATED: 'task.escalated',
  REASSIGNMENT_QUEUED: 'reassignment.queued',
  IMPORT_REQUESTED: 'import.requested',
  ATTENDANCE_CHANGED: 'attendance.changed',
} as const;
export type CrmEventType = (typeof CRM_EVENTS)[keyof typeof CRM_EVENTS];

export interface LeadCreatedPayload {
  leadId: string;
  assignedToId: string | null;
  sourceId: string | null;
  programId: string | null;
  duplicateOfLeadIds: string[];
}
export interface LeadAssignedPayload {
  leadId: string;
  fromUserId: string | null;
  toUserId: string | null;
  changedById: string | null;
  method: string;
}
export interface LeadStatusChangedPayload {
  leadId: string;
  oldStatus: string | null;
  newStatus: string;
  newCategory: string;
  changedById: string | null;
  reason: string | null;
}
export interface LeadWonPayload {
  leadId: string;
  assignedToId: string | null;
  programId: string | null;
  value: string | null;
  currency: string;
  wonAt: string;
}
export interface LeadLostPayload {
  leadId: string;
  lostReason: string;
  lostAt: string;
}
export interface TaskNotifyPayload {
  taskId: string;
  leadId: string | null;
  assignedToId: string;
  dueAt: string;
  /** which notification window this event represents (part of the idempotency key) */
  window: string;
  /** recipient override (manager/team lead escalations) */
  recipientId?: string;
  level?: number;
}
export interface LeadUnattendedPayload {
  leadId: string;
  assignedToId: string | null;
  recipientIds: string[];
  reason: 'NO_ACTIVITY' | 'NO_FIRST_CONTACT';
  window: string;
}
export interface ImportRequestedPayload {
  jobId: string;
}
export interface ReassignmentQueuedPayload {
  entryId: string;
  leadId: string | null;
  taskId: string | null;
  previousOwnerId: string | null;
  reason: string;
  managerId: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// NotificationPort: the seam between CRM reminders/escalations and the notification system (Agent F).
// CRM produces idempotent notification requests; a port implementation delivers them on a channel. Until F ships
// a provider, the worker uses the built-in in-app port (stores a row in crm_notification_deliveries).
// "queued" is never "delivered": the status progresses QUEUED -> SENT -> DELIVERED or FAILED.
// ---------------------------------------------------------------------------------------------------------------

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'PUSH' | 'WHATSAPP';
export type NotificationStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';

export interface CrmNotification {
  organizationId: string;
  recipientId: string;
  /** e.g. task.due, task.overdue, lead.unattended */
  kind: string;
  channel: NotificationChannel;
  title: string;
  body?: string;
  severity?: 'info' | 'warning' | 'critical';
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  /** unique per (entity, channel, kind, window): the port MUST treat a repeated key as a no-op */
  idempotencyKey: string;
}

export interface NotificationResult {
  status: NotificationStatus;
  providerReference?: string;
  /** provider error code on FAILED */
  errorCode?: string;
  /** true when the key had already been processed (no new delivery attempted) */
  duplicate?: boolean;
}

export interface NotificationPort {
  send(notification: CrmNotification): Promise<NotificationResult>;
}
