import { describe, expect, it } from 'vitest';
import { dayPhase } from './attendance-logic';

const base = { checkedIn: true, checkedOut: false, canCheckOut: true, hasMeeting: true, day: '2026-10-15' };
const at = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00+05:30`);

describe('dayPhase', () => {
  it('not checked in → CHECK_IN', () => expect(dayPhase({ ...base, checkedIn: false, canCheckOut: false, now: at('10:00') })).toBe('CHECK_IN'));
  it('checked in with a Zoom link, not pressed → MEETING', () => expect(dayPhase({ ...base, now: at('10:30') })).toBe('MEETING'));
  it('Zoom stays 29 min after the press and goes at 30', () => {
    const joinedAt = at('10:30').toISOString();
    expect(dayPhase({ ...base, meetingJoinedAt: joinedAt, now: at('10:59') })).toBe('MEETING');
    expect(dayPhase({ ...base, meetingJoinedAt: joinedAt, now: at('11:00') })).toBe('WORKING');
  });
  it('no Zoom link → WORKING', () => expect(dayPhase({ ...base, hasMeeting: false, now: at('12:00') })).toBe('WORKING'));
  it('Check-out appears from 18:30, even if Zoom was never pressed', () => {
    expect(dayPhase({ ...base, now: at('18:29') })).toBe('MEETING');
    expect(dayPhase({ ...base, now: at('18:30') })).toBe('CHECK_OUT');
  });
  it('honours a configured checkOutFrom', () => expect(dayPhase({ ...base, checkOutFrom: '17:00', now: at('17:00') })).toBe('CHECK_OUT'));
  it('after check-out → DONE', () => expect(dayPhase({ ...base, checkedOut: true, canCheckOut: false, now: at('19:00') })).toBe('DONE'));
});
