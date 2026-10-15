import { describe, expect, it } from 'vitest';
import { allowedPipActions, buildTransition, PIP_STATUSES, PIP_TERMINAL, slug, stepIndex, type PipActions, type PipActor, type PipLike, type PipStatus } from './pip-logic';

const pip = (status: PipStatus, over: Partial<PipLike> = {}): PipLike => ({
  status, employeeId: 'emp', extensionCount: 0, employeeAcknowledgedAt: null, goals: [{ title: 'g' }], measures: ['m'], checkpoints: [{}], ...over,
});
const actor = (roles: string[], perms: string[], meId = 'actor'): PipActor => ({ meId, roles, can: (p) => perms.includes(p) });
const TL = actor(['SALES_TEAM_LEAD'], ['pip:view', 'pip:create', 'pip:update']);
const HR = actor(['HR'], ['pip:view', 'pip:create', 'pip:update', 'pip:approve']);
const FOUNDER = actor(['FOUNDER_CEO'], ['pip:view', 'pip:approve']);
const MANAGER = actor(['SALES_MANAGER'], ['pip:view', 'pip:update']);
const EXEC = actor(['SALES_EXECUTIVE'], ['pip:view'], 'emp');
const ADMIN = actor(['ADMIN'], []);

const on = (a: PipActions) => (Object.keys(a) as (keyof PipActions)[]).filter((k) => a[k] && k !== 'submitReady').sort();

describe('allowedPipActions (docs/state-machines.md section 9)', () => {
  it('DRAFT: Team Lead / HR submit and edit; managers edit only; Founder only cancels', () => {
    expect(on(allowedPipActions(pip('DRAFT'), TL))).toEqual(['editDraft', 'submit']);
    expect(on(allowedPipActions(pip('DRAFT'), HR))).toEqual(['cancel', 'editDraft', 'submit']);
    expect(on(allowedPipActions(pip('DRAFT'), MANAGER))).toEqual(['editDraft']);
    expect(on(allowedPipActions(pip('DRAFT'), FOUNDER))).toEqual(['cancel']);
    expect(on(allowedPipActions(pip('DRAFT'), ADMIN))).toEqual([]);
  });
  it('submit is flagged not-ready until goals, measures and a checkpoint exist', () => {
    expect(allowedPipActions(pip('DRAFT'), TL).submitReady).toBe(true);
    expect(allowedPipActions(pip('DRAFT', { goals: [] }), TL).submitReady).toBe(false);
    expect(allowedPipActions(pip('DRAFT', { measures: [] }), TL).submitReady).toBe(false);
    expect(allowedPipActions(pip('DRAFT', { checkpoints: [] }), TL).submitReady).toBe(false);
  });
  it('PENDING_APPROVAL: only Founder / HR approve or return; Team Lead cannot', () => {
    expect(on(allowedPipActions(pip('PENDING_APPROVAL'), FOUNDER))).toEqual(['approveStart', 'returnToDraft']);
    expect(on(allowedPipActions(pip('PENDING_APPROVAL'), HR))).toEqual(['approveStart', 'returnToDraft']);
    expect(on(allowedPipActions(pip('PENDING_APPROVAL'), TL))).toEqual([]);
    expect(on(allowedPipActions(pip('PENDING_APPROVAL'), MANAGER))).toEqual([]);
  });
  it('ACTIVE: TL/HR extend (once) and complete; Founder may only complete as not improved or cancel; managers update checkpoints', () => {
    expect(on(allowedPipActions(pip('ACTIVE'), TL))).toEqual(['completeNotImproved', 'completeSuccess', 'requestExtension', 'updateCheckpoints']);
    expect(on(allowedPipActions(pip('ACTIVE'), HR))).toEqual(['cancel', 'completeNotImproved', 'completeSuccess', 'requestExtension', 'updateCheckpoints']);
    expect(on(allowedPipActions(pip('ACTIVE'), FOUNDER))).toEqual(['cancel', 'completeNotImproved']);
    expect(on(allowedPipActions(pip('ACTIVE'), MANAGER))).toEqual(['updateCheckpoints']);
  });
  it('a second extension is never offered', () => {
    expect(allowedPipActions(pip('ACTIVE', { extensionCount: 1 }), TL).requestExtension).toBe(false);
    expect(allowedPipActions(pip('ACTIVE', { extensionCount: 1 }), HR).requestExtension).toBe(false);
  });
  it('EXTENDED: only the approver decides; nobody completes or cancels meanwhile', () => {
    expect(on(allowedPipActions(pip('EXTENDED'), FOUNDER))).toEqual(['decideExtension']);
    expect(on(allowedPipActions(pip('EXTENDED'), HR))).toEqual(['decideExtension', 'updateCheckpoints']);
    expect(on(allowedPipActions(pip('EXTENDED'), TL))).toEqual(['updateCheckpoints']);
  });
  it('terminal states offer nothing to anyone', () => {
    for (const s of PIP_TERMINAL) for (const a of [TL, HR, FOUNDER, MANAGER, EXEC, ADMIN]) expect(on(allowedPipActions(pip(s), a)), `${s}`).toEqual([]);
  });
  it('illegal moves are never offered: no completion from DRAFT/PENDING/EXTENDED, no cancel from PENDING/EXTENDED', () => {
    for (const s of ['DRAFT', 'PENDING_APPROVAL', 'EXTENDED'] as PipStatus[]) for (const a of [TL, HR, FOUNDER]) {
      const r = allowedPipActions(pip(s), a);
      expect(r.completeSuccess || r.completeNotImproved, s).toBe(false);
    }
    for (const s of ['PENDING_APPROVAL', 'EXTENDED'] as PipStatus[]) for (const a of [TL, HR, FOUNDER]) expect(allowedPipActions(pip(s), a).cancel, s).toBe(false);
    for (const s of PIP_STATUSES.filter((x) => x !== 'DRAFT')) for (const a of [TL, HR]) expect(allowedPipActions(pip(s), a).submit, s).toBe(false);
  });
  it('the employee can only acknowledge, and only once, never act on their own plan', () => {
    for (const s of PIP_STATUSES) {
      const r = allowedPipActions(pip(s), EXEC);
      const expected = ['PENDING_APPROVAL', 'ACTIVE', 'EXTENDED'].includes(s) ? ['acknowledge'] : [];
      expect(on(r), s).toEqual(expected);
    }
    expect(on(allowedPipActions(pip('PENDING_APPROVAL', { employeeAcknowledgedAt: '2026-10-01' }), EXEC))).toEqual([]);
    // even an approver holding every permission cannot act on a plan about themselves
    const selfHr = actor(['HR'], ['pip:view', 'pip:update', 'pip:approve'], 'emp');
    expect(on(allowedPipActions(pip('PENDING_APPROVAL'), selfHr))).toEqual(['acknowledge']);
    expect(on(allowedPipActions(pip('ACTIVE'), selfHr))).toEqual(['acknowledge']);
  });
  it('permissions are required in addition to roles', () => {
    const tlNoPerm = actor(['SALES_TEAM_LEAD'], ['pip:view']);
    expect(on(allowedPipActions(pip('DRAFT'), tlNoPerm))).toEqual([]);
    const founderNoApprove = actor(['FOUNDER_CEO'], ['pip:view']);
    expect(on(allowedPipActions(pip('PENDING_APPROVAL'), founderNoApprove))).toEqual([]);
  });
});

describe('stepper', () => {
  it('maps statuses to the main path', () => {
    expect(PIP_STATUSES.map(stepIndex)).toEqual([0, 1, 2, 2, 3, 3, -1]);
  });
});

describe('buildTransition', () => {
  it('validates required fields per transition and builds the body', () => {
    expect(buildTransition('PENDING_APPROVAL', {})).toEqual({ ok: true, body: { to: 'PENDING_APPROVAL' } });
    const bad = buildTransition('EXTENDED', { reason: 'no' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toEqual({ reason: 'tooShort', newEndDate: 'required' });
    expect(buildTransition('EXTENDED', { reason: ' Illness in week two ', newEndDate: '2026-12-01' })).toEqual({ ok: true, body: { to: 'EXTENDED', reason: 'Illness in week two', newEndDate: '2026-12-01' } });
    const notImproved = buildTransition('COMPLETED_NOT_IMPROVED', { finalReview: 'Targets were not met in the period.' });
    expect(notImproved.ok).toBe(false);
    expect(buildTransition('COMPLETED_NOT_IMPROVED', { finalReview: 'Targets were not met in the period.', recommendedAction: 'Escalate to HR' })).toMatchObject({ ok: true, body: { to: 'COMPLETED_NOT_IMPROVED', recommendedAction: 'Escalate to HR' } });
    expect(buildTransition('COMPLETED_SUCCESS', { finalReview: 'short' }).ok).toBe(false);
    expect(buildTransition('CANCELLED', { reason: '' }).ok).toBe(false);
    expect(buildTransition('CANCELLED', { reason: 'Employee transferred' })).toEqual({ ok: true, body: { to: 'CANCELLED', reason: 'Employee transferred' } });
  });
  it('slug makes API-safe KPI keys', () => {
    expect(slug('Revenue achievement (%)')).toBe('revenue-achievement');
    expect(slug('???')).toBe('kpi');
  });
});
