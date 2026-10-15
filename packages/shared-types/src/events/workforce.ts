/** Workforce domain events (outbox). Payloads never carry narrative text or money; recipients are resolved by the notifier. */
export const WORKFORCE_EVENTS = {
  LEAVE_SUBMITTED: 'leave.submitted',
  LEAVE_STEP_DECIDED: 'leave.step_decided',
  LEAVE_APPROVED: 'leave.approved',
  LEAVE_REJECTED: 'leave.rejected',
  LEAVE_CANCELLED: 'leave.cancelled',
  EARNED_LEAVE_CREDITED: 'earned_leave.credited',
  ATTENDANCE_CORRECTED: 'attendance.corrected',
  GOAL_CREATED: 'goal.created',
  GOAL_SUBMITTED: 'goal.submitted',
  GOAL_VERIFIED: 'goal.verified',
  GOAL_RETURNED: 'goal.returned',
  GOAL_AT_RISK: 'goal.at_risk',
  WORK_TASK_ASSIGNED: 'work_task.assigned',
  WORK_TASK_UPDATED: 'work_task.updated',
  WORK_TASK_OVERDUE: 'work_task.overdue',
  PAYROLL_CALCULATED: 'payroll.calculated',
  PAYROLL_APPROVED: 'payroll.approved',
  PAYROLL_PAID: 'payroll.paid',
} as const;
export type WorkforceEventType = (typeof WORKFORCE_EVENTS)[keyof typeof WORKFORCE_EVENTS];

export interface EarnedLeaveCreditedPayload {
  organizationId: string;
  userId: string;
  txnId: string;
  amount: string;
  balanceAfter: string;
  periodStart: string;
  periodEnd: string;
}
