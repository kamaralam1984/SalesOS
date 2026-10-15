import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKFORCE_CONFIG, type AttendanceStatusKey } from '@salesos/validation';
import {
  addDays, advanceEarnedLeave, applyDecision, buildCalendar, cappedCredit, classifyCheckIn, classifyCheckOut, countLeaveDays, deriveClosedDayStatus, eachDay,
  emptyElState, evaluateBalance, evaluateDay, expiryAmount, isClosedDay, leaveCoverage, leaveOverlaps, planApprovalSteps, startOfLocalDay, summarise,
  type ElDayOutcome, type HolidayInput,
} from '@salesos/workforce-core';

/** Area A pure engines: attendance classification, day-close derivation, leave rules, Earned Leave counter. */
const cfg = DEFAULT_WORKFORCE_CONFIG; // Sunday off, 20 eligible days -> 1 EL, lateAfter 10:15, fullDay 480, halfDay 240
const hol = (date: string, over: Partial<HolidayInput> = {}): HolidayInput => ({ date, name: 'H', kind: 'NATIONAL', status: 'APPROVED', ...over });
const cal = (holidays: HolidayInput[] = []) => buildCalendar(cfg, holidays);
// 2026-10-05 is a Monday; 2026-10-11 a Sunday
const at = (hhmmIst: string, day = '2026-10-05') => new Date(`${day}T${hhmmIst}:00+05:30`);

describe('check-in / check-out classification', () => {
  it('office check-in is LATE only strictly after lateAfter (local time)', () => {
    expect(classifyCheckIn(cfg, at('10:15'), 'OFFICE')).toBe('PRESENT');
    expect(classifyCheckIn(cfg, at('10:16'), 'OFFICE')).toBe('LATE');
    expect(classifyCheckIn(cfg, at('09:00'), 'OFFICE')).toBe('PRESENT');
  });
  it('WFH is never late', () => expect(classifyCheckIn(cfg, at('13:00'), 'WFH')).toBe('WFH'));
  it('check-out: full day keeps the status, short day becomes HALF_DAY, very short is flagged for review', () => {
    expect(classifyCheckOut(cfg, 'PRESENT', at('09:00'), at('17:00'))).toEqual({ workMinutes: 480, status: 'PRESENT', needsReview: false });
    expect(classifyCheckOut(cfg, 'LATE', at('10:30'), at('17:00'))).toMatchObject({ workMinutes: 390, status: 'HALF_DAY', needsReview: false });
    expect(classifyCheckOut(cfg, 'PRESENT', at('09:00'), at('11:00'))).toMatchObject({ workMinutes: 120, status: 'HALF_DAY', needsReview: true });
    expect(classifyCheckOut(cfg, 'WFH', at('09:00'), at('17:00')).status).toBe('WFH');
  });
  it('never negative minutes', () => expect(classifyCheckOut(cfg, 'PRESENT', at('10:00'), at('09:00')).workMinutes).toBe(0));
  it('a day is closed only once the business-timezone date has moved on (IST midnight, not UTC)', () => {
    expect(isClosedDay('2026-10-05', new Date('2026-10-05T18:00:00Z'), 'Asia/Kolkata')).toBe(false); // 23:30 IST on the 5th is still the 5th
    expect(isClosedDay('2026-10-05', new Date('2026-10-05T18:29:00Z'), 'Asia/Kolkata')).toBe(false);
    expect(isClosedDay('2026-10-05', new Date('2026-10-05T18:30:00Z'), 'Asia/Kolkata')).toBe(true);
  });
  it('startOfLocalDay is the UTC instant of local midnight', () => expect(startOfLocalDay('2026-10-05', 'Asia/Kolkata').toISOString()).toBe('2026-10-04T18:30:00.000Z'));
  it('summary counts statuses and minutes', () => {
    const s = summarise([{ status: 'PRESENT', workMinutes: 480 }, { status: 'LATE', workMinutes: 400 }, { status: 'ABSENT' }]);
    expect(s).toMatchObject({ PRESENT: 1, LATE: 1, ABSENT: 1, workMinutes: 880 });
  });
});

describe('day-close derivation (closed day without a record)', () => {
  const d = (day: string, cover: Parameters<typeof deriveClosedDayStatus>[0]['cover'] = null, autoMarkAbsent = true) => deriveClosedDayStatus({ day, calendar: cal([hol('2026-10-02')]), cover, autoMarkAbsent });
  it('weekly off and approved holiday win over leave and absence', () => {
    expect(d('2026-10-11', { kind: 'ON_LEAVE' })).toBe('WEEKLY_OFF');
    expect(d('2026-10-02', { kind: 'ON_LEAVE' })).toBe('HOLIDAY');
  });
  it('approved leave maps to ON_LEAVE / UNPAID_LEAVE / HALF_DAY', () => {
    expect(d('2026-10-05', { kind: 'ON_LEAVE' })).toBe('ON_LEAVE');
    expect(d('2026-10-05', { kind: 'UNPAID_LEAVE' })).toBe('UNPAID_LEAVE');
    expect(d('2026-10-05', { kind: 'HALF' })).toBe('HALF_DAY');
  });
  it('otherwise ABSENT when autoMarkAbsent, else left unmarked', () => {
    expect(d('2026-10-05')).toBe('ABSENT');
    expect(d('2026-10-05', null, false)).toBeNull();
  });
  it('a SUGGESTED holiday never closes a day as HOLIDAY', () => {
    expect(deriveClosedDayStatus({ day: '2026-10-02', calendar: cal([hol('2026-10-02', { status: 'SUGGESTED' })]), cover: null, autoMarkAbsent: true })).toBe('ABSENT');
  });
});

describe('leave rules', () => {
  it('counts working days only: weekly off and approved holidays are excluded', () => {
    const c = cal([hol('2026-10-07')]);
    expect(countLeaveDays(c, '2026-10-05', '2026-10-12')).toBe(6); // Mon..Mon = 8 days minus Wed holiday, minus Sunday
    expect(countLeaveDays(c, '2026-10-11', '2026-10-11')).toBe(0);
  });
  it('half day = 0.5 on a single working day, 0 otherwise', () => {
    expect(countLeaveDays(cal(), '2026-10-05', '2026-10-05', 'FIRST_HALF')).toBe(0.5);
    expect(countLeaveDays(cal(), '2026-10-05', '2026-10-06', 'FIRST_HALF')).toBe(0);
    expect(countLeaveDays(cal(), '2026-10-11', '2026-10-11', 'SECOND_HALF')).toBe(0);
  });
  it('overlap: ranges that intersect clash, opposite halves of one day do not', () => {
    const r = (s: string, e: string, h: 'NONE' | 'FIRST_HALF' | 'SECOND_HALF' = 'NONE') => ({ startDate: s, endDate: e, halfDay: h });
    expect(leaveOverlaps(r('2026-10-05', '2026-10-07'), r('2026-10-07', '2026-10-09'))).toBe(true);
    expect(leaveOverlaps(r('2026-10-05', '2026-10-06'), r('2026-10-07', '2026-10-09'))).toBe(false);
    expect(leaveOverlaps(r('2026-10-05', '2026-10-05', 'FIRST_HALF'), r('2026-10-05', '2026-10-05', 'SECOND_HALF'))).toBe(false);
    expect(leaveOverlaps(r('2026-10-05', '2026-10-05', 'FIRST_HALF'), r('2026-10-05', '2026-10-05', 'FIRST_HALF'))).toBe(true);
    expect(leaveOverlaps(r('2026-10-05', '2026-10-05', 'FIRST_HALF'), r('2026-10-05', '2026-10-06'))).toBe(true);
  });
  it('balance: enough, BLOCK, and unpaid-with-confirmation', () => {
    const base = { needsBalance: true, confirmUnpaid: false };
    expect(evaluateBalance({ ...base, days: 2, available: 3, balanceExceeded: 'BLOCK' })).toEqual({ ok: true, unpaidDays: 0 });
    expect(evaluateBalance({ ...base, days: 4, available: 3, balanceExceeded: 'BLOCK' })).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE', shortfall: 1 });
    expect(evaluateBalance({ ...base, days: 4, available: 3, balanceExceeded: 'UNPAID_WITH_CONFIRMATION' })).toMatchObject({ ok: false, code: 'UNPAID_CONFIRMATION_REQUIRED' });
    expect(evaluateBalance({ ...base, days: 4, available: 3, balanceExceeded: 'UNPAID_WITH_CONFIRMATION', confirmUnpaid: true })).toEqual({ ok: true, unpaidDays: 1 });
    expect(evaluateBalance({ ...base, needsBalance: false, days: 9, available: 0, balanceExceeded: 'BLOCK' })).toEqual({ ok: true, unpaidDays: 0 });
    expect(evaluateBalance({ ...base, days: 0.5, available: -2, balanceExceeded: 'BLOCK' })).toMatchObject({ ok: false, available: 0 });
  });
  it('approval chain: Manager then HR; no manager skips the manager step; a lone MANAGER chain still gets an HR step', () => {
    expect(planApprovalSteps(['MANAGER', 'HR'], true)).toEqual({ steps: [{ step: 'MANAGER', status: 'PENDING' }, { step: 'HR', status: 'PENDING' }], status: 'PENDING_MANAGER' });
    expect(planApprovalSteps(['MANAGER', 'HR'], false)).toEqual({ steps: [{ step: 'MANAGER', status: 'SKIPPED' }, { step: 'HR', status: 'PENDING' }], status: 'PENDING_HR' });
    expect(planApprovalSteps(['MANAGER'], false).status).toBe('PENDING_HR'); // nobody can approve their own leave by omission
    expect(planApprovalSteps(['HR'], true).status).toBe('PENDING_HR');
  });
  it('decisions: both approve = APPROVED, any reject = REJECTED (terminal)', () => {
    const s0 = planApprovalSteps(['MANAGER', 'HR'], true).steps;
    const s1 = applyDecision(s0, 'MANAGER', 'APPROVE');
    expect(s1.status).toBe('PENDING_HR');
    expect(applyDecision(s1.steps, 'HR', 'APPROVE').status).toBe('APPROVED');
    expect(applyDecision(s1.steps, 'HR', 'REJECT').status).toBe('REJECTED');
    expect(applyDecision(s0, 'MANAGER', 'REJECT').status).toBe('REJECTED');
    // deciding an already decided step changes nothing
    expect(applyDecision(s1.steps, 'MANAGER', 'REJECT').status).toBe('PENDING_HR');
  });
  it('coverage: paid days first, then unpaid; unpaid types are UNPAID throughout; half day is HALF', () => {
    const c = cal();
    const span = { startDate: '2026-10-05', endDate: '2026-10-08', halfDay: 'NONE' as const };
    const mixed = leaveCoverage({ ...span, days: 4, unpaidDays: 1 }, true, c);
    expect([...mixed.values()].map((v) => v.kind)).toEqual(['ON_LEAVE', 'ON_LEAVE', 'ON_LEAVE', 'UNPAID_LEAVE']);
    expect([...leaveCoverage({ ...span, days: 4, unpaidDays: 0 }, false, c).values()].every((v) => v.kind === 'UNPAID_LEAVE')).toBe(true);
    expect(leaveCoverage({ startDate: '2026-10-05', endDate: '2026-10-05', halfDay: 'FIRST_HALF', days: 0.5, unpaidDays: 0 }, true, c).get('2026-10-05')).toEqual({ kind: 'HALF' });
    expect(leaveCoverage({ startDate: '2026-10-10', endDate: '2026-10-12', halfDay: 'NONE', days: 2, unpaidDays: 0 }, true, c).has('2026-10-11')).toBe(false); // Sunday
  });
});

describe('Earned Leave engine', () => {
  const run = (days: Array<{ day: string; status: AttendanceStatusKey | null }>, config = cfg, calendar = cal(), join: string | null = null, halfLeave: string[] = []) =>
    days.map(({ day, status }) => evaluateDay({ config, calendar, day, status, source: 'RECORD', joinDate: join, halfDayLeave: halfLeave.includes(day) }));
  /** n PRESENT working days from Monday 2026-10-05 (Sundays skipped; they would be 0 anyway) */
  const present = (n: number, from = '2026-10-05', status: AttendanceStatusKey = 'PRESENT') => {
    const out: Array<{ day: string; status: AttendanceStatusKey | null }> = [];
    for (let d = from; out.length < n; d = addDays(d, 1)) if (cal().isWorkingDay(d)) out.push({ day: d, status });
    return out;
  };
  const go = (outcomes: ElDayOutcome[], state = emptyElState()) => advanceEarnedLeave(state, outcomes, cfg.earnedLeave.requiredEligibleDays);

  it('treatment: present/late/wfh count 1, half day 0.5, absent/leave skip, weekly off and holiday never count', () => {
    const o = run([
      { day: '2026-10-05', status: 'PRESENT' }, { day: '2026-10-06', status: 'LATE' }, { day: '2026-10-07', status: 'WFH' }, { day: '2026-10-08', status: 'HALF_DAY' },
      { day: '2026-10-09', status: 'ABSENT' }, { day: '2026-10-10', status: 'ON_LEAVE' }, { day: '2026-10-12', status: 'UNPAID_LEAVE' }, { day: '2026-10-11', status: 'WEEKLY_OFF' }, { day: '2026-10-13', status: null },
    ]);
    expect(o.map((x) => x.eligible)).toEqual([1, 1, 1, 0.5, 0, 0, 0, 0, 0]);
    expect(o[8]).toMatchObject({ status: 'NO_RECORD', reason: 'NO_RECORD' });
  });
  it('an approved holiday is not eligible even if someone has a record on it', () => {
    expect(run([{ day: '2026-10-07', status: 'PRESENT' }], cfg, cal([hol('2026-10-07')]))[0]).toMatchObject({ eligible: 0, reason: 'HOLIDAY' });
  });
  it('days before the joining date never count (mid-month joiner)', () => {
    const o = run([{ day: '2026-10-05', status: 'PRESENT' }, { day: '2026-10-12', status: 'PRESENT' }], cfg, cal(), '2026-10-12');
    expect(o.map((x) => x.eligible)).toEqual([0, 1]);
    expect(o[0]!.reason).toBe('BEFORE_JOINING');
  });
  it('a half-day approved leave on a worked day counts 0.5', () => {
    expect(run([{ day: '2026-10-05', status: 'PRESENT' }], cfg, cal(), null, ['2026-10-05'])[0]).toMatchObject({ eligible: 0.5, reason: 'HALF_DAY_LEAVE' });
  });

  it('exactly 20 eligible days credits once; 19 does not', () => {
    const r19 = go(run(present(19)));
    expect(r19.credits).toHaveLength(0);
    expect(r19.state.eligibleDays).toBe(19);
    const r20 = go(run(present(20)));
    expect(r20.credits).toHaveLength(1);
    expect(r20.credits[0]).toMatchObject({ n: 1, eligibleDays: 20, carriedOut: 0 });
    expect(r20.state).toMatchObject({ eligibleDays: 0, creditsGiven: 1 });
    expect(r20.credits[0]!.days.reduce((n, d) => n + d.eligible, 0)).toBe(20); // the stored explanation adds up to the requirement
  });
  it('19 days + one half day does not credit; 19 + 1 more does', () => {
    const base = go(run(present(19)));
    const half = go(run([{ day: addDays(base.state.processedThrough!, 1), status: 'HALF_DAY' as const }]), base.state);
    expect(half.credits).toHaveLength(0);
    expect(half.state.eligibleDays).toBe(19.5);
    const more = go(run([{ day: addDays(half.state.processedThrough!, 1), status: 'PRESENT' as const }]), half.state);
    expect(more.credits).toHaveLength(1);
    expect(more.state.eligibleDays).toBe(0.5); // remainder carried
    expect(more.state.dayLog[0]).toMatchObject({ status: 'CARRY', eligible: 0.5 });
  });
  it('absence, unpaid leave and weekly offs inside the period delay the credit', () => {
    const days = [...present(10), { day: '2026-10-20', status: 'ABSENT' as const }, { day: '2026-10-21', status: 'UNPAID_LEAVE' as const }];
    const mid = go(run(days));
    expect(mid.state.eligibleDays).toBe(10);
    expect(mid.credits).toHaveLength(0);
  });
  it('processed days are never evaluated twice and a re-run adds no credit (idempotent)', () => {
    const o = run(present(25));
    const first = go(o);
    const again = go(o, first.state);
    expect(again.credits).toHaveLength(0);
    expect(again.state).toEqual(first.state);
    // splitting the days across two runs gives the same credits as one run
    const a = go(o.slice(0, 10));
    const b = go(o, a.state);
    expect(a.credits.length + b.credits.length).toBe(first.credits.length);
    expect(b.state.eligibleDays).toBe(first.state.eligibleDays);
  });
  it('credit numbers are sequential so the unique key EL:<user>:<n> can never repeat', () => {
    const r = go(run(present(60)));
    expect(r.credits.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(new Set(r.credits.map((c) => c.periodEnd)).size).toBe(3);
  });
  it('a changed requirement (policy) applies to the open period only; earlier credits keep their own rule', () => {
    const first = advanceEarnedLeave(emptyElState(), run(present(10)), 10);
    expect(first.credits).toHaveLength(1);
    const next = advanceEarnedLeave(first.state, run(present(10, addDays(first.state.processedThrough!, 1))), 5);
    expect(next.credits).toHaveLength(2);
  });
  it('probation extension or a department change does not reset the counter (it only reads attendance)', () => {
    const half = go(run(present(12)));
    const rest = go(run(present(8, addDays(half.state.processedThrough!, 1))), half.state);
    expect(rest.credits).toHaveLength(1);
  });
  it('holiday calendar changes: a day approved as holiday after the fact simply is not eligible on the next evaluation', () => {
    const before = run([{ day: '2026-10-07', status: 'PRESENT' }]);
    const after = run([{ day: '2026-10-07', status: 'PRESENT' }], cfg, cal([hol('2026-10-07')]));
    expect([before[0]!.eligible, after[0]!.eligible]).toEqual([1, 0]);
  });
  it('cap and year-end rules', () => {
    expect(cappedCredit(1, 10, null)).toBe(1);
    expect(cappedCredit(1, 9.5, 10)).toBe(0.5);
    expect(cappedCredit(1, 10, 10)).toBe(0);
    expect(expiryAmount(cfg, 12)).toBe(0); // carry-forward enabled
    const noCarry = { earnedLeave: { ...cfg.earnedLeave, carryForwardEnabled: false, carryForwardMax: 5 } };
    expect(expiryAmount(noCarry, 12)).toBe(7);
    expect(expiryAmount(noCarry, 3)).toBe(0);
    expect(expiryAmount({ earnedLeave: { ...cfg.earnedLeave, carryForwardEnabled: false, carryForwardMax: null } }, 12)).toBe(0);
  });
  it('eachDay helper bounds', () => expect(eachDay('2026-10-05', '2026-10-07')).toHaveLength(3));
});
