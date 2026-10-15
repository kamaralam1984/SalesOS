import { notify, NotifyValidationError, NOTIFICATION_CATALOGUE } from '@salesos/platform-core';
import { IDENTITY_EVENTS, PEOPLE_EVENTS, PLATFORM_EVENTS, SOP_EVENTS, type DomainEvent, type NotificationTypeKey, type NotifyRequest } from '@salesos/shared-types';
import type { JobRegistry } from '../registry';

type Payload = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Recipient fields producers may use, in priority order (docs/platform-report.md section 1.1). */
const USER_FIELDS = ['userId', 'ownerId', 'assignedToId', 'assigneeId', 'toUserId', 'requesterId', 'managerId', 'recipientId', 'authorId'] as const;

interface Mapping {
  type: NotificationTypeKey;
  /** default recipient roles when the payload names nobody */
  roles?: string[];
  /** ignore user ids in the payload: notify `roles` only (e.g. approvers must hear about an item that names the employee) */
  rolesOnly?: boolean;
  /** payload field holding the recipient user id when it is not one of USER_FIELDS (e.g. the employee of an HR record) */
  userField?: string;
  /** also notify these roles even when the payload names users */
  alsoRoles?: string[];
  title?: string;
  url?: (p: Payload, ev: DomainEvent) => string | undefined;
  entityType?: string;
}

const lead = (p: Payload) => (str(p.leadId) ? `/crm/leads/${str(p.leadId)}` : undefined);
const MAPPINGS: Record<string, Mapping> = {
  'task.due': { type: 'follow_up.due', url: lead, entityType: 'task' },
  'task.reminder': { type: 'follow_up.due', url: lead, entityType: 'task' },
  'task.overdue': { type: 'follow_up.overdue', url: lead, entityType: 'task' },
  'task.escalated': { type: 'follow_up.escalated', url: lead, entityType: 'task' },
  'lead.unattended': { type: 'lead.no_next_action', url: lead, entityType: 'lead' },
  'lead.exception_raised': { type: 'lead.exception', url: lead, entityType: 'lead', roles: ['SALES_MANAGER'] },
  'complaint.created': { type: 'complaint.created', url: (p, e) => `/cx/complaints/${str(p.complaintId) ?? e.aggregateId}`, entityType: 'complaint' },
  'complaint.escalated': { type: 'complaint.escalated', roles: ['SALES_TEAM_LEAD', 'FOUNDER_CEO'], url: (p, e) => `/cx/complaints/${str(p.complaintId) ?? e.aggregateId}`, entityType: 'complaint' },
  'complaint.acknowledged': { type: 'complaint.updated', url: (p, e) => `/cx/complaints/${str(p.complaintId) ?? e.aggregateId}`, entityType: 'complaint' },
  'complaint.resolved': { type: 'complaint.updated', url: (p, e) => `/cx/complaints/${str(p.complaintId) ?? e.aggregateId}`, entityType: 'complaint' },
  'payment.recorded': { type: 'collection.status_changed', roles: ['FINANCE'], url: () => '/revenue/collections', entityType: 'payment' },
  'payment.verified': { type: 'collection.status_changed', url: () => '/revenue/collections', entityType: 'payment' },
  'payment.rejected': { type: 'collection.status_changed', url: () => '/revenue/collections', entityType: 'payment' },
  'payment.reversed': { type: 'collection.status_changed', url: () => '/revenue/collections', entityType: 'payment' },
  'refund.requested': { type: 'refund.status_changed', roles: ['FINANCE'], url: () => '/revenue/refunds', entityType: 'refund' },
  'refund.reviewed': { type: 'refund.status_changed', roles: ['FOUNDER_CEO', 'FINANCE'], url: () => '/revenue/refunds', entityType: 'refund' },
  'refund.approved': { type: 'refund.status_changed', url: () => '/revenue/refunds', entityType: 'refund' },
  'refund.rejected': { type: 'refund.status_changed', url: () => '/revenue/refunds', entityType: 'refund' },
  'refund.processed': { type: 'refund.status_changed', url: () => '/revenue/refunds', entityType: 'refund' },
  'handover.submitted': { type: 'handover.pending', roles: ['STUDENT_SUCCESS'], url: (p, e) => `/cx/handovers/${str(p.handoverId) ?? e.aggregateId}`, entityType: 'handover' },
  'handover.overdue': { type: 'handover.overdue', roles: ['STUDENT_SUCCESS'], url: (p, e) => `/cx/handovers/${str(p.handoverId) ?? e.aggregateId}`, entityType: 'handover' },
  'handover.acknowledged': { type: 'handover.update', url: (p, e) => `/cx/handovers/${str(p.handoverId) ?? e.aggregateId}`, entityType: 'handover' },
  'handover.completed': { type: 'handover.update', url: (p, e) => `/cx/handovers/${str(p.handoverId) ?? e.aggregateId}`, entityType: 'handover' },
  'handover.info_requested': { type: 'handover.update', url: (p, e) => `/cx/handovers/${str(p.handoverId) ?? e.aggregateId}`, entityType: 'handover' },
  'import.completed': { type: 'import.completed', url: () => '/crm/imports', entityType: 'import_job' },
  'import.failed': { type: 'import.failed', alsoRoles: ['ADMIN'], url: () => '/crm/imports', entityType: 'import_job' },
  // --- people + SOP (docs/people-report.md section 6). Alerts name no HR content; the link opens the permission-checked page.
  [PEOPLE_EVENTS.REVIEW_SUBMITTED]: { type: 'review.pending', roles: ['SALES_TEAM_LEAD', 'HR'], rolesOnly: true, url: () => '/people/reviews', entityType: 'performance_review' },
  [PEOPLE_EVENTS.REVIEW_APPROVED]: { type: 'review.pending', userField: 'employeeId', title: 'Your performance review is ready to acknowledge', url: () => '/people/reviews', entityType: 'performance_review' },
  [PEOPLE_EVENTS.COACHING_ACTION_ASSIGNED]: { type: 'coaching.action_pending', url: () => '/people/coaching', entityType: 'coaching_action' },
  [PEOPLE_EVENTS.PIP_SUBMITTED]: { type: 'pip.update', roles: ['FOUNDER_CEO', 'HR'], rolesOnly: true, url: () => '/people/pips', entityType: 'improvement_plan' },
  [PEOPLE_EVENTS.PIP_RETURNED]: { type: 'pip.update', roles: ['SALES_TEAM_LEAD'], rolesOnly: true, url: () => '/people/pips', entityType: 'improvement_plan' },
  [PEOPLE_EVENTS.PIP_ACTIVATED]: { type: 'pip.update', userField: 'employeeId', url: () => '/people/pips', entityType: 'improvement_plan' },
  [PEOPLE_EVENTS.PIP_EXTENDED]: { type: 'pip.update', userField: 'employeeId', url: () => '/people/pips', entityType: 'improvement_plan' },
  [PEOPLE_EVENTS.PIP_COMPLETED]: { type: 'pip.update', userField: 'employeeId', url: () => '/people/pips', entityType: 'improvement_plan' },
  [PEOPLE_EVENTS.PIP_CANCELLED]: { type: 'pip.update', userField: 'employeeId', url: () => '/people/pips', entityType: 'improvement_plan' },
  [PEOPLE_EVENTS.PIP_ACK_REMINDER]: { type: 'pip.update', userField: 'employeeId', title: 'Please acknowledge your improvement plan', url: () => '/people/pips', entityType: 'improvement_plan' },
  [PEOPLE_EVENTS.INCENTIVE_SUBMITTED]: { type: 'incentive.update', roles: ['FOUNDER_CEO'], rolesOnly: true, url: () => '/people/incentives', entityType: 'incentive_recommendation' },
  [PEOPLE_EVENTS.INCENTIVE_CLAWBACK_PROPOSED]: { type: 'incentive.update', roles: ['FOUNDER_CEO'], rolesOnly: true, url: () => '/people/incentives', entityType: 'incentive_recommendation' },
  [PEOPLE_EVENTS.INCENTIVE_APPROVED]: { type: 'incentive.update', roles: ['FINANCE'], rolesOnly: true, url: () => '/people/incentives', entityType: 'incentive_recommendation' },
  [PEOPLE_EVENTS.INCENTIVE_PAID]: { type: 'incentive.update', userField: 'employeeId', url: () => '/people/incentives', entityType: 'incentive_recommendation' },
  [PEOPLE_EVENTS.RESOURCE_ASSIGNED]: { type: 'resource.assigned', url: () => '/people/resources', entityType: 'resource_assignment' },
  [PEOPLE_EVENTS.RECOGNITION_GRANTED]: { type: 'recognition.received', url: () => '/people/recognition', entityType: 'recognition' },
  [PEOPLE_EVENTS.PROBATION_DUE]: { type: 'probation.review_due', roles: ['HR', 'SALES_TEAM_LEAD'], rolesOnly: true, url: () => '/people/onboarding', entityType: 'probation_review' },
  [SOP_EVENTS.VERSION_SUBMITTED]: { type: 'sop.approval_pending', roles: ['SALES_TEAM_LEAD', 'FOUNDER_CEO'], rolesOnly: true, url: () => '/sop', entityType: 'sop_version' },
  [SOP_EVENTS.VERSION_REJECTED]: { type: 'sop.update', userField: 'authorId', title: 'Your playbook version was returned', url: () => '/sop', entityType: 'sop_version' },
  [SOP_EVENTS.ACK_REMINDER]: { type: 'sop.ack_due', url: () => '/sop', entityType: 'sop_version' },
  [PLATFORM_EVENTS.FILE_READY]: { type: 'file.ready', entityType: 'file' },
  [PLATFORM_EVENTS.FILE_FAILED]: { type: 'file.failed', alsoRoles: ['ADMIN'], url: () => '/admin/files', entityType: 'file' },
};

function recipients(p: Payload, m: Mapping): Pick<NotifyRequest, 'userIds' | 'roles'> | null {
  const users = new Set<string>(m.rolesOnly ? [] : strs(p.notifyUserIds));
  if (!m.rolesOnly) {
    for (const f of m.userField ? [m.userField] : USER_FIELDS) {
      const v = str(p[f]);
      if (v) { users.add(v); break; }
    }
  }
  const roles = new Set<string>([...strs(p.notifyRoles), ...(m.alsoRoles ?? [])]);
  if (users.size === 0 && roles.size === 0) for (const r of m.roles ?? []) roles.add(r);
  if (users.size === 0 && roles.size === 0) return null;
  return { ...(users.size ? { userIds: [...users] } : {}), ...(roles.size ? { roles: [...roles] } : {}) };
}

const CRM_AUTO_TYPES = new Set(['task.due', 'task.reminder', 'task.overdue', 'task.escalated', 'lead.unattended', 'lead.exception_raised']);

export function mapEvent(ev: DomainEvent): NotifyRequest | null {
  const m = MAPPINGS[ev.eventType];
  if (!m || !ev.organizationId) return null;
  const p = (ev.payload ?? {}) as Payload;
  const to = recipients(p, m);
  if (!to) return null;
  const def = NOTIFICATION_CATALOGUE[m.type];
  const variant = str(p.dueAt) ?? str(p.status) ?? str(p.level) ?? str(p.version) ?? str(p.to) ?? str(p.dueDate) ?? '';
  return {
    organizationId: ev.organizationId, type: m.type, ...to,
    entity: { type: m.entityType ?? ev.aggregateType, id: ev.aggregateId },
    dedupeKey: `${ev.eventType}:${ev.aggregateId}:${variant}`.slice(0, 190),
    title: str(p.title) ?? m.title ?? def.defaultTitle, body: str(p.message) ?? str(p.reason) ?? undefined,
    actionUrl: m.url?.(p, ev) ?? (str(p.actionUrl)?.startsWith('/') ? str(p.actionUrl) : undefined),
    payload: { eventType: ev.eventType, eventId: ev.id },
  };
}

export function registerNotificationEvents(registry: JobRegistry): void {
  const handle = (build: (ev: DomainEvent) => NotifyRequest | null) => async (ev: DomainEvent, ctx: Parameters<Parameters<JobRegistry['onEvent']>[1]>[1]) => {
    const req = build(ev);
    if (!req) {
      ctx.log.debug({ eventId: ev.id, type: ev.eventType }, 'no notification recipients for event');
      return;
    }
    try {
      const r = await notify(ctx.prisma, req);
      ctx.log.info({ eventId: ev.id, type: ev.eventType, ...r, notificationIds: undefined }, 'notification raised');
    } catch (e) {
      if (e instanceof NotifyValidationError) { ctx.log.warn({ eventId: ev.id, err: e.message }, 'malformed notification request dropped'); return; }
      throw e; // transient: retried by the event consumer (idempotent via dedupeKey)
    }
  };

  // The CRM worker routes follow-up/lead notifications through createCrmNotificationPort (KI-F-04, resolved), so the
  // generic mapping of those CRM events is OFF by default (opt in with PLATFORM_AUTO_NOTIFY_CRM_EVENTS=true only when
  // the CRM handlers are disabled): otherwise one fact would raise two notifications.
  const autoCrm = process.env.PLATFORM_AUTO_NOTIFY_CRM_EVENTS === 'true';
  for (const type of Object.keys(MAPPINGS)) {
    if (!autoCrm && CRM_AUTO_TYPES.has(type)) continue;
    registry.onEvent(type, handle(mapEvent));
  }

  // Generic contract: any domain publishes notification.requested with a NotifyRequest payload.
  registry.onEvent(PLATFORM_EVENTS.NOTIFICATION_REQUESTED, handle((ev) => {
    const p = ev.payload as NotifyRequest;
    return { ...p, organizationId: ev.organizationId ?? p.organizationId };
  }));

  // Security events (targets are derived from identity events).
  registry.onEvent(IDENTITY_EVENTS.USER_ROLES_CHANGED, handle((ev) => {
    const p = ev.payload as Payload;
    const userId = str(p.userId);
    if (!ev.organizationId || !userId) return null;
    return { organizationId: ev.organizationId, type: 'security.event', userId, entity: { type: 'user', id: userId }, dedupeKey: `security:roles_changed:${ev.id}`, title: 'Your roles were changed', body: 'An administrator changed your role assignments. If this was unexpected, contact your administrator.', actionUrl: '/notifications' };
  }));
  registry.onEvent(IDENTITY_EVENTS.USER_DEACTIVATED, handle((ev) => {
    const p = ev.payload as Payload;
    const userId = str(p.userId);
    if (!ev.organizationId || !userId) return null;
    const mgr = str(p.managerId);
    return { organizationId: ev.organizationId, type: 'security.event', ...(mgr ? { userIds: [mgr] } : {}), roles: ['FOUNDER_CEO'], entity: { type: 'user', id: userId }, dedupeKey: `security:user_deactivated:${ev.id}`, title: 'A team member account was deactivated', body: 'Open leads and tasks of that user need reassignment.', actionUrl: '/admin/users' };
  }));
}
