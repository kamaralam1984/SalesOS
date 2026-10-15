import { describe, expect, it } from 'vitest';
import {
  actionItemCompletion, breachLevelAt, canonicalJson, COMPLAINT_RULES, complaintDeadlines, contentHash, DEFAULT_CX_CONFIG, detectBreaches, ESCALATION_RULES, findRule, handoverChecklist,
  HANDOVER_RULES, lastCompletedPeriod, looksLikeContactDetails, missingHandoverFields, periodContaining, piiKeyPaths, reportCompleteness, reportDueAt, reportTimeliness, resolveCxConfig,
  risksMissingSolution, toWorkingHours, WORK_RULES,
} from '@salesos/cx-core';
import { CX_COMPLAINT_CATEGORIES, CX_COMPLAINT_PRIORITIES, CX_COMPLAINT_STATUSES, CX_DEPARTMENTS, CX_HANDOVER_STATUSES, CX_LANGUAGES, CX_ROOT_CAUSES, CX_WORK_STATUSES } from '@salesos/validation';
import { COMPLAINT_CATEGORIES, COMPLAINT_PRIORITIES, COMPLAINT_STATUSES, LANGUAGES, ROOT_CAUSE_CATEGORIES, XF_DEPARTMENTS } from '@salesos/cx-core';

const wh = toWorkingHours(DEFAULT_CX_CONFIG);
// Mon 2026-10-12 09:00 IST = 03:30 UTC
const mon9 = new Date('2026-10-12T03:30:00.000Z');

describe('vocabularies stay in sync between validation and cx-core', () => {
  it('matches', () => {
    expect([...CX_COMPLAINT_PRIORITIES]).toEqual([...COMPLAINT_PRIORITIES]);
    expect([...CX_COMPLAINT_STATUSES]).toEqual([...COMPLAINT_STATUSES]);
    expect([...CX_COMPLAINT_CATEGORIES]).toEqual([...COMPLAINT_CATEGORIES]);
    expect([...CX_ROOT_CAUSES]).toEqual([...ROOT_CAUSE_CATEGORIES]);
    expect([...CX_LANGUAGES]).toEqual([...LANGUAGES]);
    expect([...CX_DEPARTMENTS]).toEqual([...XF_DEPARTMENTS]);
    expect(CX_WORK_STATUSES.length).toBe(6);
    expect(CX_HANDOVER_STATUSES.length).toBe(6);
  });
});

describe('complaint SLA (DEC-017) in business time', () => {
  it('P1: first response 4 business hours, resolution 2 business days', () => {
    const d = complaintDeadlines('P1', mon9, DEFAULT_CX_CONFIG, wh);
    expect(d.firstResponseDueAt.toISOString()).toBe('2026-10-12T07:30:00.000Z'); // 13:00 IST same day
    // 2 days x 10 working hours = 20h => Tue 19:00 IST
    expect(d.resolutionDueAt.toISOString()).toBe('2026-10-13T13:30:00.000Z');
  });
  it('a complaint logged after hours starts counting at the next opening', () => {
    const sat7pm = new Date('2026-10-17T13:30:00.000Z'); // Sat 19:00 IST -> next working time Mon 09:00
    const d = complaintDeadlines('P1', sat7pm, DEFAULT_CX_CONFIG, wh);
    expect(d.firstResponseDueAt.toISOString()).toBe('2026-10-19T07:30:00.000Z');
  });
  it('P2..P4 follow the configured table and are configurable', () => {
    expect(DEFAULT_CX_CONFIG.complaintSla.P2).toEqual({ firstResponseHours: 8, resolveDays: 3 });
    const cfg = resolveCxConfig({ complaintSla: { P3: { firstResponseHours: 2, resolveDays: 1 } } });
    expect(cfg.complaintSla.P3).toEqual({ firstResponseHours: 2, resolveDays: 1 });
    expect(cfg.complaintSla.P1).toEqual({ firstResponseHours: 4, resolveDays: 2 });
    expect(resolveCxConfig({ complaintSla: { P3: { firstResponseHours: -1 } } })).toEqual(DEFAULT_CX_CONFIG); // invalid => safe defaults
  });
  it('breach detection: first-response stops at acknowledgement; closed complaints never breach', () => {
    const base = { status: 'OPEN', acknowledgedAt: null, firstResponseDueAt: new Date('2026-10-12T07:30:00Z'), resolutionDueAt: new Date('2026-10-13T13:30:00Z'), firstResponseBreachedAt: null, resolutionBreachedAt: null };
    expect(detectBreaches(base, new Date('2026-10-12T07:29:00Z'))).toEqual([]);
    expect(detectBreaches(base, new Date('2026-10-12T07:31:00Z'))).toEqual(['FIRST_RESPONSE']);
    expect(detectBreaches({ ...base, acknowledgedAt: new Date('2026-10-12T05:00:00Z'), status: 'ACKNOWLEDGED' }, new Date('2026-10-12T08:00:00Z'))).toEqual([]);
    expect(detectBreaches(base, new Date('2026-10-14T00:00:00Z'))).toEqual(['FIRST_RESPONSE', 'RESOLUTION']);
    expect(detectBreaches({ ...base, status: 'RESOLVED' }, new Date('2026-10-20T00:00:00Z'))).toEqual([]);
    expect(detectBreaches({ ...base, firstResponseBreachedAt: new Date() }, new Date('2026-10-12T08:00:00Z'))).toEqual([]);
  });
  it('escalation chain: owner, then team lead, then founder (P1 only)', () => {
    expect(breachLevelAt(0, 'P1', DEFAULT_CX_CONFIG)).toBe(1);
    expect(breachLevelAt(239, 'P1', DEFAULT_CX_CONFIG)).toBe(1);
    expect(breachLevelAt(240, 'P1', DEFAULT_CX_CONFIG)).toBe(2);
    expect(breachLevelAt(480, 'P1', DEFAULT_CX_CONFIG)).toBe(3);
    expect(breachLevelAt(5000, 'P3', DEFAULT_CX_CONFIG)).toBe(2);
  });
});

describe('state machines expose exactly the documented transitions', () => {
  const allowed = (rules: readonly { from: readonly string[]; to: string }[], from: string, to: string) => !!findRule(rules as never, from, to);
  it('complaint (section 7)', () => {
    const legal = [['OPEN', 'ACKNOWLEDGED'], ['ACKNOWLEDGED', 'IN_PROGRESS'], ['IN_PROGRESS', 'ESCALATED'], ['ESCALATED', 'IN_PROGRESS'], ['IN_PROGRESS', 'RESOLVED'], ['RESOLVED', 'CLOSED'], ['RESOLVED', 'REOPENED'], ['REOPENED', 'IN_PROGRESS'], ['OPEN', 'CLOSED']];
    const count = COMPLAINT_STATUSES.length;
    let n = 0;
    for (const f of COMPLAINT_STATUSES) for (const t of COMPLAINT_STATUSES) if (allowed(COMPLAINT_RULES, f, t)) n++;
    expect(n).toBe(legal.length);
    for (const [f, t] of legal) expect(allowed(COMPLAINT_RULES, f!, t!), `${f}->${t}`).toBe(true);
    expect(count).toBe(7);
    for (const [f, t] of [['OPEN', 'RESOLVED'], ['CLOSED', 'OPEN'], ['CLOSED', 'REOPENED'], ['OPEN', 'IN_PROGRESS'], ['ESCALATED', 'RESOLVED']]) expect(allowed(COMPLAINT_RULES, f!, t!), `${f}->${t}`).toBe(false);
  });
  it('handover (section 6)', () => {
    const legal = [['DRAFT', 'SUBMITTED'], ['INFO_REQUESTED', 'SUBMITTED'], ['SUBMITTED', 'ACKNOWLEDGED'], ['OVERDUE', 'ACKNOWLEDGED'], ['SUBMITTED', 'INFO_REQUESTED'], ['SUBMITTED', 'OVERDUE'], ['ACKNOWLEDGED', 'COMPLETED']];
    let n = 0;
    for (const f of CX_HANDOVER_STATUSES) for (const t of CX_HANDOVER_STATUSES) if (allowed(HANDOVER_RULES, f, t)) n++;
    expect(n).toBe(legal.length);
    for (const [f, t] of [['DRAFT', 'ACKNOWLEDGED'], ['DRAFT', 'COMPLETED'], ['COMPLETED', 'SUBMITTED'], ['SUBMITTED', 'COMPLETED'], ['OVERDUE', 'SUBMITTED']]) expect(allowed(HANDOVER_RULES, f!, t!), `${f}->${t}`).toBe(false);
    // only the system may mark OVERDUE; only Student Success may acknowledge
    expect(findRule(HANDOVER_RULES, 'SUBMITTED', 'OVERDUE')!.actors).toEqual(['SYSTEM']);
    expect(findRule(HANDOVER_RULES, 'SUBMITTED', 'ACKNOWLEDGED')!.actors).toEqual(['STUDENT_SUCCESS']);
  });
  it('task / action item (section 8): completed is terminal, system-only overdue/escalated', () => {
    for (const to of CX_WORK_STATUSES) expect(allowed(WORK_RULES, 'COMPLETED', to), `COMPLETED->${to}`).toBe(false);
    for (const to of CX_WORK_STATUSES) expect(allowed(WORK_RULES, 'CANCELLED', to), `CANCELLED->${to}`).toBe(false);
    expect(allowed(WORK_RULES, 'OPEN', 'IN_PROGRESS')).toBe(true);
    expect(allowed(WORK_RULES, 'OVERDUE', 'ESCALATED')).toBe(true);
    expect(allowed(WORK_RULES, 'OPEN', 'ESCALATED')).toBe(false);
    expect(allowed(WORK_RULES, 'ESCALATED', 'CANCELLED')).toBe(false);
    expect(findRule(WORK_RULES, 'OPEN', 'OVERDUE')!.actors).toEqual(['SYSTEM']);
    expect(findRule(WORK_RULES, 'OVERDUE', 'ESCALATED')!.actors).toEqual(['SYSTEM']);
  });
  it('relationship escalation', () => {
    expect(allowed(ESCALATION_RULES, 'OPEN', 'IN_REVIEW')).toBe(true);
    expect(allowed(ESCALATION_RULES, 'IN_REVIEW', 'RESOLVED')).toBe(true);
    expect(allowed(ESCALATION_RULES, 'RESOLVED', 'OPEN')).toBe(false);
    expect(allowed(ESCALATION_RULES, 'CANCELLED', 'IN_REVIEW')).toBe(false);
  });
});

describe('handover checklist', () => {
  const full = { learnerName: 'A', learnerContact: '+911', languagePreference: 'MR', programName: 'P', amountPaid: 0, amountDue: 100, paymentVerified: false, promisesMade: 'x', goals: 'y', objections: 'none', specialNotes: 'n', consents: { dataSharing: true } };
  it('is complete only when every required field is meaningfully filled (0 and false are valid answers)', () => {
    expect(missingHandoverFields(full, DEFAULT_CX_CONFIG.handover.requiredFields)).toEqual([]);
    expect(missingHandoverFields({ ...full, learnerName: '   ' }, DEFAULT_CX_CONFIG.handover.requiredFields)).toEqual(['learnerName']);
    expect(missingHandoverFields({ ...full, languagePreference: 'FR' }, DEFAULT_CX_CONFIG.handover.requiredFields)).toEqual(['languagePreference']);
    expect(missingHandoverFields({ ...full, paymentVerified: null }, DEFAULT_CX_CONFIG.handover.requiredFields)).toEqual(['paymentVerified']);
    expect(missingHandoverFields({ ...full, consents: { dataSharing: false } }, DEFAULT_CX_CONFIG.handover.requiredFields)).toEqual(['consents']);
    expect(missingHandoverFields({ ...full, amountPaid: null, amountDue: undefined }, DEFAULT_CX_CONFIG.handover.requiredFields).sort()).toEqual(['amountDue', 'amountPaid']);
    expect(handoverChecklist({}, ['goals', 'program']).every((i) => !i.done)).toBe(true);
  });
  it('the required set is configurable', () => {
    expect(missingHandoverFields({ learnerName: 'A' }, ['learnerName'])).toEqual([]);
  });
});

describe('Founder report maths', () => {
  it('lastCompletedPeriod / periodContaining', () => {
    expect(lastCompletedPeriod('WEEKLY', new Date('2026-10-14T06:00:00Z'), 'Asia/Kolkata')).toEqual({ start: '2026-10-05', end: '2026-10-11' });
    expect(lastCompletedPeriod('MONTHLY', new Date('2026-10-14T06:00:00Z'), 'Asia/Kolkata')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(periodContaining('WEEKLY', '2026-10-14')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(periodContaining('MONTHLY', '2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
  it('due dates: weekly = next Monday 10:00 IST; monthly = 3rd working day 10:00 IST', () => {
    expect(reportDueAt('WEEKLY', '2026-10-11', DEFAULT_CX_CONFIG, wh).toISOString()).toBe('2026-10-12T04:30:00.000Z');
    // Sep 2026 ends Wed 30 Sep: working days (Mon-Sat) Oct 1 (Thu), Oct 2 (Fri), Oct 3 (Sat) => 3rd = Oct 3
    expect(reportDueAt('MONTHLY', '2026-09-30', DEFAULT_CX_CONFIG, wh).toISOString()).toBe('2026-10-03T04:30:00.000Z');
    const cfg = resolveCxConfig({ reports: { monthlyDueWorkingDay: 1, dueTime: '18:00' } });
    expect(reportDueAt('MONTHLY', '2026-09-30', cfg, toWorkingHours(cfg)).toISOString()).toBe('2026-10-01T12:30:00.000Z');
  });
  it('timeliness: on-time / due, deferrals excluded, future-due ignored, dash when none due', () => {
    const d = (s: string) => new Date(s);
    const rows = [
      { dueAt: d('2026-10-05T04:30:00Z'), publishedAt: d('2026-10-05T04:00:00Z') }, // on time
      { dueAt: d('2026-10-12T04:30:00Z'), publishedAt: d('2026-10-12T05:00:00Z') }, // late
      { dueAt: d('2026-10-19T04:30:00Z'), publishedAt: null }, // missing (past due)
      { dueAt: d('2026-10-26T04:30:00Z'), publishedAt: null, deferred: true }, // approved deferral
      { dueAt: d('2027-01-01T04:30:00Z'), publishedAt: null }, // not yet due
    ];
    const r = reportTimeliness(rows, d('2026-10-01T00:00:00Z'), d('2027-12-31T00:00:00Z'), d('2026-10-30T00:00:00Z'));
    expect(r).toEqual({ due: 3, onTime: 1, late: 1, missing: 1, pct: 33.3 });
    expect(reportTimeliness([], d('2026-01-01T00:00:00Z'), d('2026-02-01T00:00:00Z')).pct).toBeNull();
    const exactly = reportTimeliness([{ dueAt: d('2026-10-05T04:30:00Z'), publishedAt: d('2026-10-05T04:30:00Z') }], d('2026-10-01T00:00:00Z'), d('2026-11-01T00:00:00Z'), d('2026-10-30T00:00:00Z'));
    expect(exactly.pct).toBe(100); // published exactly at the due time counts as on time
  });
  it('action-item completion (KPI-FND-001): on-time completions / items due, cancelled excluded', () => {
    const d = (s: string) => new Date(s);
    const rows = [
      { dueAt: d('2026-10-10T00:00:00Z'), status: 'COMPLETED', completedAt: d('2026-10-09T00:00:00Z') },
      { dueAt: d('2026-10-11T00:00:00Z'), status: 'COMPLETED', completedAt: d('2026-10-12T00:00:00Z') }, // late
      { dueAt: d('2026-10-12T00:00:00Z'), status: 'OVERDUE', completedAt: null },
      { dueAt: d('2026-10-13T00:00:00Z'), status: 'CANCELLED', completedAt: null },
      { dueAt: d('2026-11-13T00:00:00Z'), status: 'OPEN', completedAt: null }, // outside window
    ];
    expect(actionItemCompletion(rows, d('2026-10-01T00:00:00Z'), d('2026-11-01T00:00:00Z'))).toEqual({ due: 3, onTime: 1, pct: 33.3 });
    expect(actionItemCompletion([], d('2026-10-01T00:00:00Z'), d('2026-11-01T00:00:00Z')).pct).toBeNull();
  });
  it('completeness (DEC-028) and risks without solutions', () => {
    expect(reportCompleteness({}).pct).toBe(0);
    const s = { performance: { narrative: 'ok' }, risks: { items: [{ title: 'r', proposedSolution: 's' }] }, opportunities: { noneConfirmed: true }, actionItems: { reviewed: true } };
    expect(reportCompleteness(s).pct).toBe(100);
    expect(reportCompleteness({ ...s, risks: { items: [{ title: 'r' }] } }).pct).toBe(75);
    expect(risksMissingSolution({ risks: { items: [{ title: 'a' }, { title: 'b', proposedSolution: ' ' }, { title: 'c', proposedSolution: 'x' }] } })).toEqual(['a', 'b']);
  });
  it('content hash is deterministic and order-independent, and changes with content', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('minimum-data (PII) detection', () => {
  it('flags e-mails, phone numbers and PII-named keys', () => {
    expect(looksLikeContactDetails('call me on +91 98765 43210')).toBe(true);
    expect(looksLikeContactDetails('mail a.b@example.com')).toBe(true);
    expect(looksLikeContactDetails('12 learners asked about EMI in week 3')).toBe(false);
    expect(piiKeyPaths({ audience: { phone: '1' }, count: 3, learnerName: 'x' })).toEqual(['audience.phone', 'learnerName']);
  });
});
