import type { NotificationChannelKey, NotificationSeverityKey, NotificationTypeKey } from '@salesos/shared-types';

export interface NotificationTypeDef {
  key: NotificationTypeKey;
  label: string;
  category: 'follow_ups' | 'leads' | 'targets' | 'people' | 'cx' | 'money' | 'founder' | 'system' | 'security';
  severity: NotificationSeverityKey;
  defaultChannels: NotificationChannelKey[];
  /** user cannot switch this type off in-app (security / critical operational alerts) */
  mandatory?: boolean;
  defaultTitle: string;
}

const T = (d: NotificationTypeDef) => d;

/** Every notification type from CLAUDE.md section 15. Default delivery is in-app only (DEC-013). */
export const NOTIFICATION_CATALOGUE: Record<NotificationTypeKey, NotificationTypeDef> = {
  'follow_up.due': T({ key: 'follow_up.due', label: 'Follow-up due', category: 'follow_ups', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A follow-up is due' }),
  'follow_up.overdue': T({ key: 'follow_up.overdue', label: 'Follow-up overdue', category: 'follow_ups', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A follow-up is overdue' }),
  'follow_up.escalated': T({ key: 'follow_up.escalated', label: 'Follow-up escalated', category: 'follow_ups', severity: 'CRITICAL', defaultChannels: ['IN_APP'], defaultTitle: 'An overdue follow-up was escalated' }),
  'lead.unassigned': T({ key: 'lead.unassigned', label: 'Lead without owner', category: 'leads', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A lead has no owner' }),
  'lead.no_next_action': T({ key: 'lead.no_next_action', label: 'Lead without next action', category: 'leads', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A lead has no next action' }),
  'lead.exception': T({ key: 'lead.exception', label: 'Lead reassignment exception', category: 'leads', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A lead needs reassignment' }),
  'lead.assigned': T({ key: 'lead.assigned', label: 'Lead assigned to you', category: 'leads', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A lead was assigned to you' }),
  'reassignment.needed': T({ key: 'reassignment.needed', label: 'Reassignment needed', category: 'leads', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'Leads and tasks need reassignment' }),
  'target.at_risk': T({ key: 'target.at_risk', label: 'Target at risk', category: 'targets', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A target is at risk' }),
  'target.milestone_missed': T({ key: 'target.milestone_missed', label: 'Milestone missed', category: 'targets', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A milestone was missed' }),
  'review.pending': T({ key: 'review.pending', label: 'Review pending', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A review is waiting for you' }),
  'coaching.action_pending': T({ key: 'coaching.action_pending', label: 'Coaching action pending', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A coaching action is pending' }),
  // People / SOP (titles are deliberately generic: HR content never travels in an alert)
  'pip.update': T({ key: 'pip.update', label: 'Improvement plan update', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'An improvement plan needs your attention' }),
  'incentive.update': T({ key: 'incentive.update', label: 'Incentive update', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'An incentive recommendation changed' }),
  'recognition.received': T({ key: 'recognition.received', label: 'Recognition received', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'You received recognition' }),
  'resource.assigned': T({ key: 'resource.assigned', label: 'Learning resource assigned', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A learning resource was assigned to you' }),
  'sop.approval_pending': T({ key: 'sop.approval_pending', label: 'SOP awaiting approval', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A playbook version awaits approval' }),
  'sop.update': T({ key: 'sop.update', label: 'SOP update', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A playbook version was updated' }),
  'sop.ack_due': T({ key: 'sop.ack_due', label: 'SOP acknowledgement due', category: 'people', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'Please acknowledge a playbook' }),
  'probation.review_due': T({ key: 'probation.review_due', label: 'Probation review due', category: 'people', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A probation review is due' }),
  // Workforce (DEC-048): titles stay generic, details live behind the link
  'work_task.assigned': T({ key: 'work_task.assigned', label: 'Work task assigned', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A work task was assigned to you' }),
  'work_task.update': T({ key: 'work_task.update', label: 'Work task update', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A work task has an update' }),
  'work_task.overdue': T({ key: 'work_task.overdue', label: 'Work task overdue', category: 'people', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A work task is overdue' }),
  'goal.update': T({ key: 'goal.update', label: 'Goal update', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A goal has an update' }),
  'goal.at_risk': T({ key: 'goal.at_risk', label: 'Goal at risk', category: 'people', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A goal is at risk' }),
  'leave.pending': T({ key: 'leave.pending', label: 'Leave awaiting your decision', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A leave request is waiting for your decision' }),
  'leave.status_changed': T({ key: 'leave.status_changed', label: 'Leave request update', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'Your leave request was updated' }),
  'earned_leave.credited': T({ key: 'earned_leave.credited', label: 'Earned Leave credited', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'Earned Leave was credited to your balance' }),
  'birthday.upcoming': T({ key: 'birthday.upcoming', label: 'Upcoming birthday', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A birthday is coming up' }),
  'probation.ending_soon': T({ key: 'probation.ending_soon', label: 'Probation ending soon', category: 'people', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A probation period is ending soon' }),
  'announcement.published': T({ key: 'announcement.published', label: 'Company announcement', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A new company announcement' }),
  'payroll.update': T({ key: 'payroll.update', label: 'Payroll update', category: 'people', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A payroll update needs your attention' }),
  'attendance.exception': T({ key: 'attendance.exception', label: 'Attendance exception', category: 'people', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'An attendance exception needs attention' }),
  'complaint.created': T({ key: 'complaint.created', label: 'Complaint raised', category: 'cx', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A complaint was raised' }),
  'complaint.updated': T({ key: 'complaint.updated', label: 'Complaint update', category: 'cx', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A complaint was updated' }),
  'complaint.escalated': T({ key: 'complaint.escalated', label: 'Complaint escalated', category: 'cx', severity: 'CRITICAL', defaultChannels: ['IN_APP'], defaultTitle: 'A complaint was escalated' }),
  'collection.status_changed': T({ key: 'collection.status_changed', label: 'Collection status changed', category: 'money', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A payment status changed' }),
  'refund.status_changed': T({ key: 'refund.status_changed', label: 'Refund status changed', category: 'money', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A refund status changed' }),
  'handover.pending': T({ key: 'handover.pending', label: 'Handover pending', category: 'cx', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A handover is waiting for you' }),
  'handover.overdue': T({ key: 'handover.overdue', label: 'Handover overdue', category: 'cx', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A handover is overdue' }),
  'handover.update': T({ key: 'handover.update', label: 'Handover update', category: 'cx', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A handover was updated' }),
  'founder.action_item': T({ key: 'founder.action_item', label: 'Founder action item', category: 'founder', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'An item needs your decision' }),
  'import.completed': T({ key: 'import.completed', label: 'Import completed', category: 'system', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'An import finished' }),
  'import.failed': T({ key: 'import.failed', label: 'Import failed', category: 'system', severity: 'CRITICAL', defaultChannels: ['IN_APP'], mandatory: true, defaultTitle: 'An import failed' }),
  'file.ready': T({ key: 'file.ready', label: 'File processed', category: 'system', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'A file finished processing' }),
  'file.failed': T({ key: 'file.failed', label: 'File processing failed', category: 'system', severity: 'CRITICAL', defaultChannels: ['IN_APP'], mandatory: true, defaultTitle: 'A file could not be processed' }),
  'security.event': T({ key: 'security.event', label: 'Security event', category: 'security', severity: 'CRITICAL', defaultChannels: ['IN_APP'], mandatory: true, defaultTitle: 'Security event on your account' }),
  'system.delivery_failed': T({ key: 'system.delivery_failed', label: 'Message delivery failed', category: 'system', severity: 'WARNING', defaultChannels: ['IN_APP'], defaultTitle: 'A message could not be delivered' }),
  'digest.summary': T({ key: 'digest.summary', label: 'Notification digest', category: 'system', severity: 'INFO', defaultChannels: ['IN_APP'], defaultTitle: 'Notification digest' }),
};

export function isNotificationType(v: string): v is NotificationTypeKey {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_CATALOGUE, v);
}
