import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STAGES, DEFAULT_WORKING_HOURS, RULE_SCHEMAS, addWorkingDays, addWorkingMinutes, defaultRule, evaluateTransition, findForwardPath, isWithinWorkingHours, leadAgeing, nextWorkingTime, normalizePhone, parseCsv,
  phoneSuffix, resolveRule, toCsv, workingMinutesBetween, zonedParts, zonedToUtc,
} from '@salesos/crm-core';

const wh = DEFAULT_WORKING_HOURS; // Mon-Sat 09:00-19:00 Asia/Kolkata (DEC-020)
/** IST wall clock -> UTC instant */
const ist = (d: number, h: number, m = 0, month = 10) => zonedToUtc(2026, month, d, h, m, 'Asia/Kolkata');
const show = (d: Date) => {
  const p = zonedParts(d, 'Asia/Kolkata');
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')} ${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
};

describe('working-hours scheduling (Mon-Sat 09:00-19:00 IST)', () => {
  it('converts IST to UTC without DST drift', () => {
    expect(ist(15, 9).toISOString()).toBe('2026-10-15T03:30:00.000Z');
    expect(zonedParts(new Date('2026-10-15T20:00:00Z'), 'Asia/Kolkata')).toMatchObject({ d: 16, h: 1, min: 30, dow: 5 });
  });
  it('adds working minutes inside the day', () => expect(show(addWorkingMinutes(ist(15, 10), 180, wh))).toBe('2026-10-15 13:00'));
  it('rolls over the evening to the next morning', () => expect(show(addWorkingMinutes(ist(15, 17), 180, wh))).toBe('2026-10-16 10:00'));
  it('starts from the next opening when outside hours (evening, early morning)', () => {
    expect(show(addWorkingMinutes(ist(15, 21), 60, wh))).toBe('2026-10-16 10:00');
    expect(show(addWorkingMinutes(ist(15, 6), 60, wh))).toBe('2026-10-15 10:00');
  });
  it('skips Sunday (Saturday evening -> Monday)', () => {
    expect(show(addWorkingMinutes(ist(17, 18), 120, wh))).toBe('2026-10-19 10:00');
    expect(show(nextWorkingTime(ist(18, 12), wh))).toBe('2026-10-19 09:00');
    expect(isWithinWorkingHours(ist(17, 11), wh)).toBe(true); // Saturday is a working day
    expect(isWithinWorkingHours(ist(18, 11), wh)).toBe(false);
  });
  it('adds working days keeping the time of day and skipping Sunday', () => {
    expect(show(addWorkingDays(ist(15, 11), 1, wh))).toBe('2026-10-16 11:00');
    expect(show(addWorkingDays(ist(17, 11), 1, wh))).toBe('2026-10-19 11:00');
    expect(show(addWorkingDays(ist(15, 11), 3, wh))).toBe('2026-10-19 11:00');
  });
  it('honours holidays', () => {
    const h = { ...wh, holidays: ['2026-10-16'] };
    expect(show(addWorkingMinutes(ist(15, 17), 180, h))).toBe('2026-10-17 10:00');
  });
  it('counts working minutes between instants (nights and Sundays excluded)', () => {
    expect(workingMinutesBetween(ist(15, 18), ist(16, 10), wh)).toBe(120);
    expect(workingMinutesBetween(ist(17, 18), ist(19, 10), wh)).toBe(120);
    expect(workingMinutesBetween(ist(15, 10), ist(15, 10), wh)).toBe(0);
    expect(workingMinutesBetween(ist(15, 9), ist(16, 9), wh)).toBe(600);
  });
  it('works for another timezone and a rejecting configuration', () => {
    const ny = { timezone: 'America/New_York', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', holidays: [] };
    const fri = zonedToUtc(2026, 10, 16, 16, 0, 'America/New_York');
    const mon = addWorkingMinutes(fri, 120, ny);
    expect(zonedParts(mon, 'America/New_York')).toMatchObject({ d: 19, h: 10, min: 0 });
  });
});

describe('E.164 normalisation', () => {
  it.each([
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['(+91) 9876543210', '+919876543210'],
    ['+1 415 555 2671', '+14155552671'],
  ])('%s -> %s', (raw, e164) => {
    const r = normalizePhone(raw);
    expect(r.valid).toBe(true);
    expect(r.e164).toBe(e164);
  });
  it.each(['123', 'abc', '99999', '+91 12345'])('keeps %s raw and flagged', (raw) => {
    const r = normalizePhone(raw);
    expect(r.valid).toBe(false);
    expect(r.e164).toBeNull();
    expect(r.raw).toBe(raw);
  });
  it('empty input is flagged EMPTY', () => expect(normalizePhone('  ').reason).toBe('EMPTY'));
  it('phone suffix ignores formatting', () => expect(phoneSuffix('+91 98765-43210')).toBe('9876543210'));
});

describe('lead state machine (pure)', () => {
  const ok = (a: string, b: string) => evaluateTransition(DEFAULT_STAGES, a, b);
  it('allows the documented edges', () => {
    for (const [a, b] of [['NEW', 'CONTACT_ATTEMPTED'], ['CONTACT_ATTEMPTED', 'CONTACT_ATTEMPTED'], ['CONTACT_ATTEMPTED', 'CONNECTED'], ['CONNECTED', 'QUALIFIED'], ['CONNECTED', 'PROPOSAL_NEGOTIATION'], ['QUALIFIED', 'WEBINAR_REGISTERED'], ['QUALIFIED', 'DEMO_SCHEDULED'], ['WEBINAR_ATTENDED', 'DEMO_SCHEDULED'], ['DEMO_ATTENDED', 'PROPOSAL_NEGOTIATION'], ['PROPOSAL_NEGOTIATION', 'PAYMENT_PENDING'], ['PAYMENT_PENDING', 'WON'], ['PROPOSAL_NEGOTIATION', 'WON'], ['LOST', 'NURTURE'], ['NURTURE', 'CONTACT_ATTEMPTED'], ['LOST', 'CONTACT_ATTEMPTED']] as const) {
      expect(ok(a, b).allowed, `${a} -> ${b}`).toBe(true);
    }
  });
  it('rejects illegal edges', () => {
    for (const [a, b] of [['NEW', 'CONNECTED'], ['NEW', 'WON'], ['CONNECTED', 'WON'], ['QUALIFIED', 'WON'], ['WON', 'LOST'], ['WON', 'NEW'], ['WON', 'CONTACT_ATTEMPTED'], ['NEW', 'NURTURE'], ['CONNECTED', 'NURTURE'], ['LOST', 'LOST'], ['LOST', 'CONNECTED'], ['NEW', 'NEW'], ['NEW', 'NOPE']] as const) {
      expect(ok(a, b).allowed, `${a} -> ${b}`).toBe(false);
    }
  });
  it('LOST is reachable from every open stage and never from WON/LOST/NURTURE', () => {
    for (const s of DEFAULT_STAGES.filter((x) => x.category === 'OPEN')) expect(ok(s.key, 'LOST').allowed).toBe(true);
    expect(ok('NURTURE', 'LOST').allowed).toBe(false);
  });
  it('backward moves need a reason, forward skips of non-skippable stages are refused', () => {
    expect(ok('QUALIFIED', 'CONNECTED')).toMatchObject({ allowed: true, needsReason: true, direction: 'backward' });
    expect(ok('NEW', 'QUALIFIED').allowed).toBe(false);
    expect(ok('QUALIFIED', 'PROPOSAL_NEGOTIATION').allowed).toBe(true); // intermediate webinar/demo stages are skippable
  });
  it('forward path search walks NEW -> WON in four hops and refuses impossible paths', () => {
    expect(findForwardPath(DEFAULT_STAGES, 'NEW', 'WON')).toEqual(['CONTACT_ATTEMPTED', 'CONNECTED', 'PROPOSAL_NEGOTIATION', 'WON']);
    expect(findForwardPath(DEFAULT_STAGES, 'NEW', 'CONNECTED')).toEqual(['CONTACT_ATTEMPTED', 'CONNECTED']);
    expect(findForwardPath(DEFAULT_STAGES, 'WON', 'CONNECTED')).toBeNull();
  });
  it('custom stage configuration drives the machine (configurable stages)', () => {
    const custom = [...DEFAULT_STAGES, { key: 'VISIT', label: 'Site visit', category: 'OPEN' as const, sortOrder: 35, skippable: true, canClose: false, allowedNext: [] }];
    expect(evaluateTransition(custom, 'CONNECTED', 'QUALIFIED').allowed).toBe(true);
    expect(evaluateTransition(custom, 'CONNECTED', 'VISIT').allowed).toBe(true); // forward, nothing non-skippable in between
    expect(evaluateTransition(custom, 'NEW', 'VISIT').allowed).toBe(false);
  });
});

describe('csv', () => {
  it('parses quotes, embedded commas/newlines, CRLF, BOM and blank lines', () => {
    const r = parseCsv('﻿name,phone,note\r\n"Doe, Jane",98765 43210,"line1\nline2"\r\n\r\n"He said ""hi""",,x\n');
    expect(r.header).toEqual(['name', 'phone', 'note']);
    expect(r.rows).toEqual([['Doe, Jane', '98765 43210', 'line1\nline2'], ['He said "hi"', '', 'x']]);
  });
  it('writes csv and neutralises formula injection', () => {
    expect(toCsv([['a', '=SUM(1)'], ['+919876543210', 'x,y']])).toBe('a,\'=SUM(1)\r\n+919876543210,"x,y"\r\n');
  });
});

describe('automation rule configuration', () => {
  it('has the documented DEC-026 defaults', () => {
    expect(defaultRule('NO_ANSWER')).toEqual({ retryDelayWorkingMinutes: 180, maxAttemptsPerDay: 3, maxAttemptsTotal: 5 });
    expect(defaultRule('SWITCHED_OFF')).toEqual({ retryDelayWorkingDays: 1, consecutiveForManagerReview: 3 });
    expect(defaultRule('CALLBACK')).toEqual({ reminderMinutesBefore: 15 });
    expect(defaultRule('OVERDUE')).toMatchObject({ notifyOwnerAtMinutes: 0, repeatOwnerAfterMinutes: 240, escalateManagerAfterWorkingDays: 1, escalateTeamLeadAfterWorkingDays: 3 });
    expect(defaultRule('UNATTENDED')).toMatchObject({ noActivityWorkingDays: 3, newLeadFirstContactMinutes: 60 });
    expect(defaultRule('WORKING_HOURS')).toMatchObject({ timezone: 'Asia/Kolkata', days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '19:00' });
  });
  it('resolves default < organization < team and ignores inactive rows', () => {
    const rows = [
      { teamId: null, ruleKey: 'NO_ANSWER', config: { retryDelayWorkingMinutes: 120 }, isActive: true },
      { teamId: 't1', ruleKey: 'NO_ANSWER', config: { retryDelayWorkingMinutes: 45 }, isActive: true },
      { teamId: 't2', ruleKey: 'NO_ANSWER', config: { retryDelayWorkingMinutes: 10 }, isActive: false },
    ];
    expect(resolveRule(rows, 'NO_ANSWER', null).retryDelayWorkingMinutes).toBe(120);
    expect(resolveRule(rows, 'NO_ANSWER', 't1').retryDelayWorkingMinutes).toBe(45);
    expect(resolveRule(rows, 'NO_ANSWER', 't2').retryDelayWorkingMinutes).toBe(120);
    expect(resolveRule(rows, 'NO_ANSWER', 't1').maxAttemptsTotal).toBe(5);
  });
  it('rejects unknown keys, bad times and negative numbers', () => {
    expect(RULE_SCHEMAS.NO_ANSWER.safeParse({ retryDelayWorkingMinutes: -5 }).success).toBe(false);
    expect(RULE_SCHEMAS.NO_ANSWER.safeParse({ bogus: 1 }).success).toBe(false);
    expect(RULE_SCHEMAS.WORKING_HOURS.safeParse({ start: '19:00', end: '09:00' }).success).toBe(false);
    expect(RULE_SCHEMAS.WORKING_HOURS.safeParse({ start: '9am' }).success).toBe(false);
  });
});

describe('lead ageing', () => {
  it('measures since creation AND since last meaningful activity (falls back to creation)', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    const day = 86_400_000;
    const a = leadAgeing({ createdAt: new Date(+now - 20 * day), lastActivityAt: new Date(+now - 2 * day) }, now);
    expect(a).toMatchObject({ sinceCreationDays: 20, sinceActivityDays: 2, creationBucket: '15-30d', activityBucket: '2-3d' });
    const untouched = leadAgeing({ createdAt: new Date(+now - 5 * day), lastActivityAt: null }, now);
    expect(untouched).toMatchObject({ sinceCreationDays: 5, sinceActivityDays: 5, activityBucket: '4-7d' });
  });
});
