// Owned by the cx agent. Event-type constants + payload interfaces for CX, handover, collaboration and Founder reporting.
// Recipient resolution: every payload carries `notifyUserIds` / `notifyRoles` so the platform notifier (Agent F,
// jobs/platform) needs no domain knowledge (docs/platform-report.md section 1.1).

export const CX_EVENTS = {
  COMPLAINT_CREATED: 'complaint.created',
  COMPLAINT_ACKNOWLEDGED: 'complaint.acknowledged',
  COMPLAINT_UPDATED: 'complaint.updated',
  COMPLAINT_ESCALATED: 'complaint.escalated',
  COMPLAINT_RESOLVED: 'complaint.resolved',
  COMPLAINT_CLOSED: 'complaint.closed',
  COMPLAINT_REOPENED: 'complaint.reopened',
  /** SLA breach (first response or resolution); level 1 owner, 2 team lead, 3 founder (P1) */
  COMPLAINT_SLA_BREACHED: 'complaint.sla_breached',
  ESCALATION_RAISED: 'escalation.raised',
  ESCALATION_UPDATED: 'escalation.updated',
  HANDOVER_CREATED: 'handover.created',
  HANDOVER_SUBMITTED: 'handover.submitted',
  HANDOVER_INFO_REQUESTED: 'handover.info_requested',
  HANDOVER_ACKNOWLEDGED: 'handover.acknowledged',
  HANDOVER_OVERDUE: 'handover.overdue',
  HANDOVER_COMPLETED: 'handover.completed',
  /** survey scheduling requests (consumed by Phase 8/CX follow-up; idempotent) */
  SURVEY_REQUESTED: 'survey.requested',
  XF_TASK_CREATED: 'xf_task.created',
  XF_TASK_UPDATED: 'xf_task.updated',
  XF_TASK_COMPLETED: 'xf_task.completed',
  XF_TASK_CONFIRMED: 'xf_task.confirmed',
  XF_TASK_OVERDUE: 'xf_task.overdue',
  XF_TASK_ESCALATED: 'xf_task.escalated',
  ACTION_ITEM_CREATED: 'action_item.created',
  ACTION_ITEM_COMPLETED: 'action_item.completed',
  ACTION_ITEM_OVERDUE: 'action_item.overdue',
  ACTION_ITEM_ESCALATED: 'action_item.escalated',
  FOUNDER_REPORT_PUBLISHED: 'founder_report.published',
  FOUNDER_REPORT_DUE: 'founder_report.due',
  FOUNDER_REPORT_OVERDUE: 'founder_report.overdue',
  INSIGHT_SHARED: 'insight.shared',
} as const;
export type CxEventType = (typeof CX_EVENTS)[keyof typeof CX_EVENTS];

export interface CxNotifyTargets {
  organizationId: string;
  notifyUserIds?: string[];
  notifyRoles?: string[];
}

export interface ComplaintEventPayload extends CxNotifyTargets {
  complaintId: string;
  status: string;
  priority: string;
  ownerId: string;
  leadId: string | null;
  level?: number;
  breach?: 'FIRST_RESPONSE' | 'RESOLUTION';
  actorId?: string | null;
}

export interface HandoverEventPayload extends CxNotifyTargets {
  handoverId: string;
  status: string;
  ownerId: string;
  dealId: string | null;
  leadId: string | null;
  level?: number;
  actorId?: string | null;
}

export interface ActionItemEventPayload extends CxNotifyTargets {
  actionItemId: string;
  status: string;
  ownerId: string;
  dueAt: string;
  level?: number;
}

export interface XfTaskEventPayload extends CxNotifyTargets {
  taskId: string;
  status: string;
  ownerId: string;
  department: string;
  dueAt: string;
  level?: number;
}

export interface FounderReportEventPayload extends CxNotifyTargets {
  reportId: string;
  type: string;
  periodStart: string;
  dueAt: string;
  onTime?: boolean;
  contentHash?: string;
}

/**
 * Contract for the revenue domain (Agent G). The handover is created from either event; payload fields are read
 * tolerantly (first present wins) so the final names can differ without a code change:
 *   deal id:      dealId | id
 *   learner:      leadId
 *   sales owner:  ownerId | assignedToId | creditedOwnerId
 *   program:      programId
 *   amounts:      amount | value | finalAmount, amountCollected | collected, currency
 * Events: `deal.closed` / `deal.won` (revenue) and `lead.won` (CRM, payload LeadWonPayload).
 */
export const HANDOVER_TRIGGER_EVENTS = ['lead.won', 'deal.closed', 'deal.won'] as const;

export interface HandoverTriggerPayload {
  dealId?: string;
  id?: string;
  leadId?: string | null;
  ownerId?: string | null;
  assignedToId?: string | null;
  creditedOwnerId?: string | null;
  programId?: string | null;
  amount?: string | number | null;
  value?: string | number | null;
  finalAmount?: string | number | null;
  saleValue?: string | number | null;
  amountCollected?: string | number | null;
  collected?: string | number | null;
  currency?: string | null;
  /** deal.closed may carry the result: only WON closes trigger a handover */
  outcome?: string | null;
  status?: string | null;
}
