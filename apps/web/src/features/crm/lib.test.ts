import { describe, expect, it } from 'vitest';
import { dispositionSchema, fromIstInput, isPast, quickPick, toCallBody, toIstInput, toTel } from './lib';

const schema = dispositionSchema({ lostNoteRequired: (r) => r === 'OTHER', now: () => Date.parse('2026-10-15T06:00:00Z') });
const base = { notes: '', interestLevel: '', objectionCategory: '', nextActionAt: '', nextActionType: 'FOLLOW_UP', callbackAt: '', lostReason: '', lostNote: '', wonValue: '' };
const issues = (v: Record<string, unknown>) => { const r = schema.safeParse({ ...base, ...v }); return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`); };

describe('IST helpers (Asia/Kolkata, UTC+05:30)', () => {
  it('round-trips wall-clock input', () => {
    expect(fromIstInput('2026-10-15T10:00')).toBe('2026-10-15T04:30:00.000Z');
    expect(toIstInput(new Date('2026-10-15T04:30:00Z'))).toBe('2026-10-15T10:00');
    expect(fromIstInput('')).toBeNull();
    expect(fromIstInput('garbage')).toBeNull();
  });
  it('quick picks: +3h, tomorrow 10:00 IST, in 2 days 10:00 IST', () => {
    const now = new Date('2026-10-15T20:00:00Z'); // 01:30 IST on 16 Oct
    expect(quickPick('plus3h', now)).toBe('2026-10-16T04:30');
    expect(quickPick('tomorrow10', now)).toBe('2026-10-17T10:00');
    expect(quickPick('plus2d', now)).toBe('2026-10-18T10:00');
  });
  it('isPast tolerates 5 minutes', () => {
    expect(isPast('2026-10-15T05:56:00Z', Date.parse('2026-10-15T06:00:00Z'))).toBe(false);
    expect(isPast('2026-10-15T05:50:00Z', Date.parse('2026-10-15T06:00:00Z'))).toBe(true);
  });
  it('tel link keeps + and digits only', () => expect(toTel('+91 98765-43210')).toBe('tel:+919876543210'));
});

describe('disposition validation mirrors the API', () => {
  it('CONNECTED needs interest and a next action', () => {
    expect(issues({ outcome: 'CONNECTED' })).toEqual(['interestLevel:crmInterestRequired', 'nextActionAt:crmNextActionRequired']);
    expect(issues({ outcome: 'CONNECTED', interestLevel: 'HIGH', nextActionAt: '2026-10-16T10:00' })).toEqual([]);
  });
  it('CALLBACK needs a time; BUSY and NO_ANSWER do not', () => {
    expect(issues({ outcome: 'CALLBACK' })).toEqual(['callbackAt:crmCallbackRequired']);
    expect(issues({ outcome: 'BUSY' })).toEqual([]);
    expect(issues({ outcome: 'NO_ANSWER' })).toEqual([]);
    expect(issues({ outcome: 'SWITCHED_OFF' })).toEqual([]);
    expect(issues({ outcome: 'FAILED' })).toEqual([]);
  });
  it('LOST needs a reason and a note when the reason requires one', () => {
    expect(issues({ outcome: 'LOST' })).toEqual(['lostReason:crmLostReasonRequired']);
    expect(issues({ outcome: 'LOST', lostReason: 'OTHER' })).toEqual(['lostNote:crmLostNoteRequired']);
    expect(issues({ outcome: 'LOST', lostReason: 'PRICE' })).toEqual([]);
  });
  it('WON needs a positive value', () => {
    expect(issues({ outcome: 'WON' })).toEqual(['wonValue:crmWonValueRequired']);
    expect(issues({ outcome: 'WON', wonValue: '0' })).toEqual(['wonValue:crmWonValueRequired']);
    expect(issues({ outcome: 'WON', wonValue: '49999' })).toEqual([]);
  });
  it('rejects past follow-up times', () => {
    expect(issues({ outcome: 'NO_ANSWER', nextActionAt: '2026-10-14T10:00' })).toEqual(['nextActionAt:crmPast']);
  });
  it('the request body never carries a source (calls are MANUAL) and only relevant fields', () => {
    const body = toCallBody({ ...base, outcome: 'LOST', lostReason: 'PRICE', nextActionAt: '2026-10-16T10:00', interestLevel: '' } as never, 'task-1');
    expect(body).toEqual({ outcome: 'LOST', lostReason: 'PRICE', taskId: 'task-1' });
    expect('source' in body).toBe(false);
    const c = toCallBody({ ...base, outcome: 'CONNECTED', interestLevel: 'HIGH', nextActionAt: '2026-10-16T10:00', nextActionType: 'DEMO' } as never);
    expect(c).toMatchObject({ outcome: 'CONNECTED', interestLevel: 'HIGH', nextActionAt: '2026-10-16T04:30:00.000Z', nextActionType: 'DEMO' });
  });
});
