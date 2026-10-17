import { describe, expect, it } from 'vitest';
import { myActivePlan, planDay } from './onboarding-card';
import type { Plan } from '@/features/people/onboarding/api';

const at = (d: string) => new Date(`${d}T10:00:00+05:30`);
const plan = (over: Partial<Plan> = {}): Plan => ({ id: 'p', employeeId: 'me', employeeName: null, startDate: '2026-10-01', status: 'ACTIVE', progress: { total: 12, done: 3, skipped: 0, pct: 25 }, items: [], ...over });

describe('planDay', () => {
  it('counts from day 1 on the start date', () => {
    expect(planDay('2026-10-01', at('2026-10-01'))).toBe(1);
    expect(planDay('2026-10-01', at('2026-10-17'))).toBe(17);
  });
  it('is 90 on the last day and null after it', () => {
    expect(planDay('2026-10-01', at('2026-12-29'))).toBe(90);
    expect(planDay('2026-10-01', at('2026-12-30'))).toBeNull();
  });
  it('is null without a start date', () => expect(planDay(null)).toBeNull());
});

describe('myActivePlan', () => {
  const now = at('2026-10-17');
  it('returns only my own active plan inside the 90 days', () => {
    expect(myActivePlan([plan({ id: 'a', employeeId: 'other' }), plan({ id: 'b' })], 'me', now)?.id).toBe('b');
  });
  it('ignores completed plans, expired plans and no user', () => {
    expect(myActivePlan([plan({ status: 'COMPLETED' })], 'me', now)).toBeUndefined();
    expect(myActivePlan([plan({ startDate: '2026-01-01' })], 'me', now)).toBeUndefined();
    expect(myActivePlan([plan()], undefined, now)).toBeUndefined();
  });
});
