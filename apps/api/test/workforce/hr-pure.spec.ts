import { describe, expect, it } from 'vitest';
import { dayDiff, hrPolicy, monthDay, nextBirthday, probationEnd, probationState, reminderDueToday } from '@salesos/workforce-core';

describe('HR pure helpers (area D2)', () => {
  it('probation end = join + months with day clamping; an override wins (extension)', () => {
    expect(probationEnd('2026-01-15', 3)).toBe('2026-04-15');
    expect(probationEnd('2026-11-30', 3)).toBe('2027-02-28');
    expect(probationEnd('2026-01-15', 3, '2026-05-15')).toBe('2026-05-15');
  });
  it('probation state: in probation, ending soon, decision due, confirmed, under review', () => {
    expect(probationState('2026-12-31', '2026-10-15', 30)).toMatchObject({ state: 'IN_PROBATION', daysLeft: 77 });
    expect(probationState('2026-11-10', '2026-10-15', 30)).toMatchObject({ state: 'ENDING_SOON', daysLeft: 26 });
    expect(probationState('2026-11-14', '2026-10-15', 30).state).toBe('ENDING_SOON');
    expect(probationState('2026-10-15', '2026-10-15', 30)).toMatchObject({ state: 'ENDING_SOON', daysLeft: 0 });
    expect(probationState('2026-10-14', '2026-10-15', 30)).toMatchObject({ state: 'DECISION_DUE', daysLeft: -1 });
    expect(probationState('2026-10-14', '2026-10-15', 30, 'CONFIRM').state).toBe('CONFIRMED');
    expect(probationState('2026-12-14', '2026-10-15', 30, 'MARK_FOR_REVIEW').state).toBe('UNDER_REVIEW');
  });
  it('extension moves the state back out of decision-due', () => {
    expect(probationState('2026-10-14', '2026-10-15', 7).state).toBe('DECISION_DUE');
    expect(probationState(probationEnd('2026-07-14', 3, '2027-01-14'), '2026-10-15', 7).state).toBe('IN_PROBATION');
  });
  it('dayDiff is signed and handles month/year boundaries', () => {
    expect(dayDiff('2026-12-30', '2027-01-02')).toBe(3);
    expect(dayDiff('2027-01-02', '2026-12-30')).toBe(-3);
    expect(dayDiff('2026-10-15', '2026-10-15')).toBe(0);
  });
  it('next birthday: today counts, past dates roll to next year, 29 Feb is observed on 28 Feb in non-leap years', () => {
    expect(nextBirthday('1990-10-15', '2026-10-15')).toEqual({ date: '2026-10-15', daysUntil: 0 });
    expect(nextBirthday('1990-10-14', '2026-10-15')).toEqual({ date: '2027-10-14', daysUntil: 364 });
    expect(nextBirthday('1992-02-29', '2026-10-15').date).toBe('2027-02-28');
    expect(nextBirthday('1992-02-29', '2027-10-15').date).toBe('2028-02-29');
    expect(nextBirthday('1990-01-02', '2026-12-30')).toEqual({ date: '2027-01-02', daysUntil: 3 });
  });
  it('monthDay never carries the year; reminders fire only on configured offsets', () => {
    expect(monthDay('1990-03-07')).toEqual({ month: 3, day: 7 });
    expect(reminderDueToday(3, [7, 3, 1])).toBe(true);
    expect(reminderDueToday(4, [7, 3, 1])).toBe(false);
    expect(reminderDueToday(3, [])).toBe(false);
  });
  it('hrPolicy fills defaults and respects stored overrides', () => {
    expect(hrPolicy(undefined)).toMatchObject({ probationDefaultMonths: 3, probationReminderDays: [7], birthdayReminderDays: [7, 3, 1] });
    expect(hrPolicy({ hr: { probationDefaultMonths: 6 } }).probationDefaultMonths).toBe(6);
  });
});
