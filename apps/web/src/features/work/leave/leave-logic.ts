import type { LeaveRequest, LeaveStatus } from '@/lib/api/hooks/work-leave';

export type Tone = 'neutral' | 'gold' | 'red' | 'blue' | 'green';
export const leaveTone = (s: LeaveStatus): Tone => (s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'red' : s === 'CANCELLED' ? 'neutral' : 'gold');
export const stepTone = (s: string): Tone => (s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'red' : s === 'PENDING' ? 'gold' : 'neutral');

/** "2" -> "2", "0.50" -> "0.5" (decimal strings from the API; leave days are multiples of 0.5). */
export const trimDays = (s: string | number): string => String(Number(s));

/** Whether the request spans a single day (half-day choices only apply then). */
export const isSingleDay = (start: string, end: string) => Boolean(start) && start === end;

export interface UnpaidPrompt { shortfall: number; available: number }
/** The 409 UNPAID_CONFIRMATION_REQUIRED details, or null. */
export function unpaidPrompt(e: unknown): UnpaidPrompt | null {
  const err = e as { code?: string; details?: { shortfall?: number; available?: number } } | null;
  if (err?.code !== 'UNPAID_CONFIRMATION_REQUIRED' || typeof err.details?.shortfall !== 'number') return null;
  return { shortfall: err.details.shortfall, available: err.details.available ?? 0 };
}

/** The step a pending request is waiting for, as a label key. */
export const waitingFor = (r: Pick<LeaveRequest, 'status'>): 'MANAGER' | 'HR' | null => (r.status === 'PENDING_MANAGER' ? 'MANAGER' : r.status === 'PENDING_HR' ? 'HR' : null);
