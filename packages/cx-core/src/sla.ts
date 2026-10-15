import { addWorkingMinutes, workingMinutesPerDay, type WorkingHours } from '@salesos/crm-core';
import type { ComplaintPriorityKey } from './constants';
import { slaFor, type CxConfig } from './config';

export interface ComplaintDeadlines {
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
}

/** Adds working minutes and returns the exact instant (a deadline that falls on closing time stays at closing time, not next morning). */
function addBusinessMinutes(from: Date, minutes: number, wh: WorkingHours): Date {
  if (minutes <= 0) return from;
  return new Date(addWorkingMinutes(from, minutes - 1, wh).getTime() + 60_000);
}

/** DEC-017: deadlines are measured in BUSINESS time (working hours/days per DEC-020), starting at `from`. */
export function complaintDeadlines(priority: ComplaintPriorityKey, from: Date, cfg: CxConfig, wh: WorkingHours): ComplaintDeadlines {
  const sla = slaFor(cfg, priority);
  const firstMin = Math.round(sla.firstResponseHours * 60);
  const resolveMin = Math.round(sla.resolveDays * workingMinutesPerDay(wh));
  return { firstResponseDueAt: addBusinessMinutes(from, firstMin, wh), resolutionDueAt: addBusinessMinutes(from, resolveMin, wh) };
}

export type BreachKind = 'FIRST_RESPONSE' | 'RESOLUTION';

export interface ComplaintSlaState {
  status: string;
  acknowledgedAt: Date | null;
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
  firstResponseBreachedAt: Date | null;
  resolutionBreachedAt: Date | null;
}

/** Which breaches are newly detectable at `now` (pure; the sweep persists them atomically). */
export function detectBreaches(c: ComplaintSlaState, now: Date): BreachKind[] {
  const out: BreachKind[] = [];
  const open = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'ESCALATED', 'REOPENED'].includes(c.status);
  if (!open) return out;
  // first-response SLA stops at acknowledgement; a REOPENED complaint restarts the clock with acknowledgedAt reset
  if (!c.acknowledgedAt && !c.firstResponseBreachedAt && c.firstResponseDueAt.getTime() < now.getTime()) out.push('FIRST_RESPONSE');
  if (!c.resolutionBreachedAt && c.resolutionDueAt.getTime() < now.getTime()) out.push('RESOLUTION');
  return out;
}

/** Escalation level a breach has reached `minutesSinceBreach` after it happened (1 owner, 2 team lead, 3 founder). */
export function breachLevelAt(minutesSinceBreach: number, priority: ComplaintPriorityKey, cfg: CxConfig): number {
  const e = cfg.complaintEscalation;
  let level = 1;
  if (minutesSinceBreach >= e.teamLeadAfterMinutes) level = 2;
  if (minutesSinceBreach >= e.founderAfterMinutes && e.founderPriorities.includes(priority)) level = 3;
  return level;
}

/** Remaining SLA time in milliseconds (negative = breached). Used by the UI countdown and tests. */
export function slaRemainingMs(dueAt: Date, now: Date): number {
  return dueAt.getTime() - now.getTime();
}
