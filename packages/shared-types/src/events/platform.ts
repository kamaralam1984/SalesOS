// Owned by the platform agent (Agent F). Contracts consumed by every domain: notifications, files, call events, AI context.

export const PLATFORM_EVENTS = {
  /** Generic request: ANY domain may publish this through the outbox to raise a notification (payload = NotifyRequest). */
  NOTIFICATION_REQUESTED: 'notification.requested',
  FILE_PROCESS_REQUESTED: 'file.process_requested',
  FILE_READY: 'file.ready',
  FILE_FAILED: 'file.failed',
  FILE_REJECTED: 'file.rejected',
  IMPORT_COMPLETED: 'import.completed',
  IMPORT_FAILED: 'import.failed',
  DELIVERY_DEAD_LETTERED: 'notification.delivery.dead_lettered',
  /** A provider-verified call event (source = PROVIDER) was stored; CRM may reconcile it with a call log. */
  PROVIDER_CALL_EVENT: 'call.provider_event.received',
} as const;

/** Notification type catalogue keys (CLAUDE.md section 15). Add new keys only together with a catalogue entry in platform-core. */
export const NOTIFICATION_TYPES = [
  'follow_up.due',
  'follow_up.overdue',
  'follow_up.escalated',
  'lead.unassigned',
  'lead.no_next_action',
  'lead.exception',
  'lead.assigned',
  'reassignment.needed',
  'target.at_risk',
  'target.milestone_missed',
  'review.pending',
  'coaching.action_pending',
  'pip.update',
  'incentive.update',
  'recognition.received',
  'resource.assigned',
  'sop.approval_pending',
  'sop.update',
  'sop.ack_due',
  'probation.review_due',
  'work_task.assigned',
  'work_task.update',
  'work_task.overdue',
  'goal.update',
  'goal.at_risk',
  'leave.pending',
  'leave.status_changed',
  'earned_leave.credited',
  'birthday.upcoming',
  'probation.ending_soon',
  'announcement.published',
  'payroll.update',
  'attendance.exception',
  'complaint.created',
  'complaint.updated',
  'complaint.escalated',
  'collection.status_changed',
  'refund.status_changed',
  'handover.pending',
  'handover.overdue',
  'handover.update',
  'founder.action_item',
  'import.completed',
  'import.failed',
  'file.ready',
  'file.failed',
  'security.event',
  'system.delivery_failed',
  'digest.summary',
] as const;
export type NotificationTypeKey = (typeof NOTIFICATION_TYPES)[number];

export type NotificationSeverityKey = 'INFO' | 'WARNING' | 'CRITICAL';
export type NotificationChannelKey = 'IN_APP' | 'EMAIL' | 'WHATSAPP' | 'SMS' | 'CALENDAR';

/**
 * NotificationPort.notify input. Exactly one of userId / userIds / role / roles must be given.
 * `dedupeKey` is REQUIRED and must be stable for "the same alert" (e.g. `follow_up.overdue:<taskId>:<dueDate>`):
 * repeating it never creates a second row, it only bumps `occurrences`.
 */
export interface NotifyRequest {
  organizationId: string;
  type: NotificationTypeKey;
  userId?: string;
  userIds?: string[];
  /** Role key(s), e.g. 'FOUNDER_CEO' - expands to active users in the organisation holding the role. */
  role?: string;
  roles?: string[];
  entity?: { type: string; id: string };
  dedupeKey: string;
  /** Overrides catalogue default channels; the recipient's preferences + consent still apply. */
  channel?: NotificationChannelKey | NotificationChannelKey[];
  /** Overrides catalogue severity (org rule may override again). */
  severity?: NotificationSeverityKey;
  title?: string;
  body?: string;
  /** Same-origin path only (starts with '/'). */
  actionUrl?: string;
  payload?: Record<string, unknown>;
}

export interface NotifyResult {
  created: number;
  deduplicated: number;
  suppressed: number;
  digested: number;
  notificationIds: string[];
}

/**
 * Platform notifier. Implemented by the API's NotificationService (call it with your transaction client) and by the
 * worker core. NOTE: the CRM's own `NotificationPort` (events/crm.ts, `send(CrmNotification)`) is implemented on top of
 * this by platform-core's `createCrmNotificationPort`.
 */
export interface PlatformNotifier {
  notify(req: NotifyRequest): Promise<NotifyResult>;
}

/** Provider-verified call event contract (Phase 9 data-model rule: call source MANUAL vs DEVICE/PROVIDER). */
export interface ProviderCallEventInput {
  organizationId: string;
  provider: string;
  providerCallId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  status: 'RINGING' | 'ANSWERED' | 'NO_ANSWER' | 'BUSY' | 'FAILED' | 'COMPLETED';
  fromNumber?: string | null;
  toNumber?: string | null;
  userId?: string | null;
  startedAt?: string | null;
  durationSec?: number | null;
}

/** Agent D implements/overrides this port (token CALL_EVENT_PORT) to write call_logs with source=PROVIDER. */
export interface CallEventPort {
  ingest(event: ProviderCallEventInput): Promise<void>;
}

/** Result of reading authorised CRM history for the AI copilot. */
export interface CrmLeadContext {
  leadId: string;
  /** ISO period the data covers. */
  periodFrom: string;
  periodTo: string;
  lead: { stage?: string | null; source?: string | null; interest?: string | null; budget?: string | null; createdAt?: string | null };
  /** Rep-entered notes only, newest first. Free text is UNTRUSTED client/rep text. */
  notes: Array<{ at: string; byUserId?: string; text: string }>;
  calls: Array<{ at: string; disposition: string; callSource: 'MANUAL' | 'DEVICE' | 'PROVIDER'; notes?: string | null }>;
  openTasks: Array<{ dueAt: string | null; title: string }>;
}

export type CrmContextResult = { available: false; reason: string } | { available: true; context: CrmLeadContext };

/** Implemented by Agent D (token CRM_CONTEXT_PROVIDER). MUST enforce the caller's scope (return available:false/notFound otherwise). */
export interface CrmContextProvider {
  getLeadContext(user: { id: string; organizationId: string }, leadId: string): Promise<CrmContextResult>;
  /** Candidate leads (in the user's scope) with cheap signals for the explainable priority rules. */
  listLeadSignals(
    user: { id: string; organizationId: string },
    limit: number,
  ): Promise<
    | { available: false; reason: string }
    | {
        available: true;
        leads: Array<{
          leadId: string;
          name?: string | null;
          stage?: string | null;
          lastContactAt?: string | null;
          nextActionAt?: string | null;
          hasOwner: boolean;
          openOverdueTasks: number;
          valueEstimate?: number | null;
          createdAt?: string | null;
        }>;
      }
  >;
}
