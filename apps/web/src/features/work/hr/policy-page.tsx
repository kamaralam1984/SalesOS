'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Checkbox, FormField, Input, PageHeader, Panel, Select, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { ApiError } from '@/lib/api/client';
import { MutationAlert, QueryState } from '@/features/people/hub/shared';
import { usePatchWorkforceSettings, useWorkforceSettings, type PolicyConfig } from '@/lib/api/hooks/work-hr';
import { useDates } from '../common';

export function PolicyPage() {
  return (
    <RequirePermission permission="workforce:settings:view">
      <Inner />
    </RequirePermission>
  );
}

type Kind = 'bool' | 'int' | 'num' | 'numnull' | 'text' | 'time' | 'numlist' | 'textlist' | 'select' | 'url';
interface Field { path: string[]; kind: Kind; options?: string[] }
const f = (path: string, kind: Kind, options?: string[]): Field => ({ path: path.split('.'), kind, options });

/** Sections of the policy and their scalar fields. Labels: workHr.policy.fields.<path joined by '.'>. */
export const POLICY_SECTIONS: Array<{ key: string; fields: Field[] }> = [
  { key: 'general', fields: [f('timezone', 'text')] },
  { key: 'attendance', fields: [f('attendance.selfCheckIn', 'bool'), f('attendance.lateAfter', 'time'), f('attendance.checkInCutoff', 'time'), f('attendance.workdayEnd', 'time'), f('attendance.meetingUrl', 'url'), f('attendance.fullDayMinutes', 'int'), f('attendance.halfDayMinutes', 'int'), f('attendance.autoMarkAbsent', 'bool'), f('attendance.managerCorrectionWindowDays', 'int')] },
  { key: 'leave', fields: [f('leave.approvalChain', 'select', ['MANAGER,HR', 'MANAGER', 'HR']), f('leave.balanceExceeded', 'select', ['BLOCK', 'UNPAID_WITH_CONFIRMATION']), f('leave.backdateDays', 'int'), f('leave.allowHalfDay', 'bool')] },
  { key: 'earnedLeave', fields: [f('earnedLeave.enabled', 'bool'), f('earnedLeave.requiredEligibleDays', 'int'), f('earnedLeave.creditDays', 'num'), f('earnedLeave.countFromJoiningDate', 'bool'), f('earnedLeave.maxBalance', 'numnull'), f('earnedLeave.carryForwardEnabled', 'bool'), f('earnedLeave.carryForwardMax', 'numnull')] },
  { key: 'holidays', fields: [f('holidays.locations', 'textlist'), f('holidays.suggestFixedNational', 'bool'), f('holidays.optionalCountAsOff', 'bool')] },
  { key: 'goals', fields: [f('goals.cycleDays', 'int'), f('goals.atRiskGapPct', 'int'), f('goals.requireVerification', 'bool'), f('goals.reminderDaysBeforeTarget', 'numlist')] },
  { key: 'tasks', fields: [f('tasks.requireReview', 'bool'), f('tasks.reminderHoursBeforeDue', 'int')] },
  { key: 'hr', fields: [f('hr.probationDefaultMonths', 'int'), f('hr.probationReminderDays', 'numlist'), f('hr.birthdayReminderDays', 'numlist')] },
  { key: 'payroll', fields: [f('payroll.currency', 'text'), f('payroll.absentIsLossOfPay', 'bool'), f('payroll.halfDayLossOfPay', 'num')] },
];
const TREATMENT_STATUSES = ['PRESENT', 'LATE', 'WFH', 'HALF_DAY', 'ABSENT', 'HOLIDAY', 'WEEKLY_OFF', 'ON_LEAVE', 'UNPAID_LEAVE'];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const getAt = (o: unknown, path: string[]): unknown => path.reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o);
export function setAt(o: PolicyConfig, path: string[], value: unknown): void {
  let cur: Record<string, unknown> = o;
  path.slice(0, -1).forEach((k) => { cur = (cur[k] ??= {}) as Record<string, unknown>; });
  cur[path[path.length - 1]!] = value;
}
const pathKey = (p: string[]) => p.join('.');
const toText = (kind: Kind, v: unknown): string => (kind === 'numlist' || kind === 'textlist' ? (Array.isArray(v) ? v.join(', ') : '') : v === null || v === undefined ? '' : String(v));

/** Parse a text-edited field. Returns undefined when invalid. */
export function parseField(kind: Kind, raw: string): unknown {
  const s = raw.trim();
  if (kind === 'int') return /^-?\d+$/.test(s) ? Number(s) : undefined;
  if (kind === 'num') return s !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined;
  if (kind === 'numnull') return s === '' ? null : Number.isFinite(Number(s)) ? Number(s) : undefined;
  if (kind === 'numlist') {
    if (s === '') return [];
    const parts = s.split(',').map((x) => x.trim());
    return parts.every((x) => /^\d+$/.test(x)) ? parts.map(Number) : undefined;
  }
  if (kind === 'textlist') return s === '' ? [] : s.split(',').map((x) => x.trim()).filter(Boolean);
  if (kind === 'time') return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : undefined;
  if (kind === 'url') {
    if (s === '') return null;
    if (s.length > 500) return undefined;
    try { return new URL(s).protocol === 'https:' ? s : undefined; } catch { return undefined; }
  }
  return s;
}

function Inner() {
  const t = useTranslations('workHr');
  const q = useWorkforceSettings();
  return (
    <>
      <PageHeader eyebrow={t('policy.eyebrow')} title={t('policy.title')} description={t('policy.description')} />
      <QueryState query={q} isEmpty={!q.data} emptyTitle={t('policy.empty')}>
        {q.data && <Editor key={q.data.version} settings={q.data} />}
      </QueryState>
    </>
  );
}

function Editor({ settings }: { settings: NonNullable<ReturnType<typeof useWorkforceSettings>['data']> }) {
  const t = useTranslations('workHr');
  const { can } = useAuth();
  const { toast } = useToast();
  const dates = useDates();
  const canEdit = can('workforce:settings:manage');
  const patch = usePatchWorkforceSettings();
  const [draft, setDraft] = React.useState<PolicyConfig>(() => clone(settings.effective));
  const [text, setText] = React.useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of POLICY_SECTIONS) for (const fld of s.fields) if (fld.kind !== 'bool' && fld.kind !== 'select') out[pathKey(fld.path)] = toText(fld.kind, getAt(settings.effective, fld.path));
    return out;
  });
  const [invalid, setInvalid] = React.useState<string[]>([]);
  const types = (draft['leave']?.types ?? []) as Array<{ key: string; name: string; isPaid: boolean; needsBalance: boolean; maxConsecutiveDays: number | null; active: boolean }>;

  const setField = (fld: Field, v: unknown) => setDraft((d) => { const n = clone(d); setAt(n, fld.path, v); return n; });
  const restoreDefaults = () => {
    setDraft(clone(settings.defaults));
    const out: Record<string, string> = {};
    for (const s of POLICY_SECTIONS) for (const fld of s.fields) if (fld.kind !== 'bool' && fld.kind !== 'select') out[pathKey(fld.path)] = toText(fld.kind, getAt(settings.defaults, fld.path));
    setText(out);
    setInvalid([]);
  };

  const save = () => {
    const next = clone(draft);
    const bad: string[] = [];
    for (const s of POLICY_SECTIONS) for (const fld of s.fields) {
      if (fld.kind === 'bool' || fld.kind === 'select') continue;
      const parsed = parseField(fld.kind, text[pathKey(fld.path)] ?? '');
      if (parsed === undefined) bad.push(pathKey(fld.path)); else setAt(next, fld.path, parsed);
    }
    const chain = getAt(draft, ['leave', 'approvalChain']);
    if (typeof chain === 'string') setAt(next, ['leave', 'approvalChain'], (chain as string).split(','));
    setInvalid(bad);
    if (bad.length) return;
    const body: PolicyConfig = {};
    for (const key of Object.keys(next)) if (JSON.stringify(next[key]) !== JSON.stringify(settings.effective[key])) body[key] = next[key];
    if (Object.keys(body).length === 0) { toast({ title: t('policy.nothingChanged'), tone: 'info' }); return; }
    patch.mutate(body, { onSuccess: () => toast({ title: t('policy.saved'), tone: 'success' }) });
  };

  const fieldErrors = patch.error instanceof ApiError ? Object.entries(patch.error.fieldErrors) : [];
  const chainValue = (() => { const c = getAt(draft, ['leave', 'approvalChain']); return Array.isArray(c) ? c.join(',') : String(c ?? ''); })();

  return (
    <div className="enter-up min-w-0 max-w-full space-y-4">
      <Alert tone="warning" title={t('policy.proposedTitle')}>{t('policy.proposed')}</Alert>
      <p className="text-sm text-muted">{t('policy.version', { version: settings.version, when: settings.updatedAt ? dates.dateTime(settings.updatedAt) : t('policy.neverChanged') })}</p>
      {!canEdit && <Alert tone="info">{t('policy.readOnly')}</Alert>}
      {POLICY_SECTIONS.map((s, idx) => (
        <Panel key={s.key} className="enter-up" style={{ ['--enter-delay' as string]: `${Math.min(idx, 8) * 40}ms` }}title={t(`policy.sections.${s.key}` as never)} description={t(`policy.sectionHelp.${s.key}` as never)}>
          <div className="grid gap-3 sm:grid-cols-2">
            {s.fields.map((fld) => {
              const k = pathKey(fld.path);
              const label = t(`policy.fields.${k}` as never);
              if (fld.kind === 'bool') {
                return <Checkbox key={k} label={label} disabled={!canEdit} checked={Boolean(getAt(draft, fld.path))} onCheckedChange={(c) => setField(fld, c === true)} />;
              }
              if (fld.kind === 'select') {
                const value = k === 'leave.approvalChain' ? chainValue : String(getAt(draft, fld.path) ?? '');
                return (
                  <FormField key={k} label={label}>
                    <Select disabled={!canEdit} value={value} onChange={(e) => setField(fld, e.target.value)}>
                      {fld.options!.map((o) => <option key={o} value={o}>{t(`policy.options.${k}.${o.replace(",", "_")}` as never)}</option>)}
                    </Select>
                  </FormField>
                );
              }
              const hint = fld.kind === 'numlist' ? t('policy.listHint') : fld.kind === 'textlist' ? t('policy.listHint') : fld.kind === 'numnull' ? t('policy.nullHint') : k === 'attendance.checkInCutoff' || k === 'attendance.meetingUrl' ? t(`policy.hints.${k}` as never) : undefined;
              return (
                <FormField key={k} label={label} hint={hint} error={invalid.includes(k) ? t('policy.invalidValue') : undefined}>
                  <Input disabled={!canEdit} inputMode={fld.kind === 'url' ? 'url' : fld.kind === 'text' || fld.kind === 'textlist' || fld.kind === 'time' ? 'text' : 'decimal'} placeholder={k === 'attendance.meetingUrl' ? t('policy.meetingUrlPlaceholder') : undefined} value={text[k] ?? ''} onChange={(e) => setText((x) => ({ ...x, [k]: e.target.value }))} />
                </FormField>
              );
            })}
          </div>
          {s.key === 'leave' && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-ink">{t('policy.leaveTypes')}</h3>
              <ul className="space-y-2" aria-label={t('policy.leaveTypes')}>
                {types.map((lt, i) => (
                  <li key={lt.key} className="grid gap-2 rounded-lg border border-line p-2.5 sm:grid-cols-[1fr_auto_auto_auto]">
                    <FormField label={t('policy.typeName', { key: lt.key })}>
                      <Input disabled={!canEdit} value={lt.name} maxLength={60} onChange={(e) => setDraft((d) => { const n = clone(d); n['leave'].types[i].name = e.target.value; return n; })} />
                    </FormField>
                    <Checkbox label={t('policy.typePaid')} disabled={!canEdit} checked={lt.isPaid} onCheckedChange={(c) => setDraft((d) => { const n = clone(d); n['leave'].types[i].isPaid = c === true; return n; })} />
                    <Checkbox label={t('policy.typeNeedsBalance')} disabled={!canEdit} checked={lt.needsBalance} onCheckedChange={(c) => setDraft((d) => { const n = clone(d); n['leave'].types[i].needsBalance = c === true; return n; })} />
                    <Checkbox label={t('policy.typeActive')} disabled={!canEdit} checked={lt.active} onCheckedChange={(c) => setDraft((d) => { const n = clone(d); n['leave'].types[i].active = c === true; return n; })} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.key === 'earnedLeave' && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold text-ink">{t('policy.treatment')}</h3>
              <p className="mb-2 text-xs text-muted">{t('policy.treatmentHelp')}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {TREATMENT_STATUSES.map((st) => (
                  <FormField key={st} label={t(`policy.status.${st}` as never)}>
                    <Select disabled={!canEdit} value={String(getAt(draft, ['earnedLeave', 'treatment', st]) ?? 'SKIP')} onChange={(e) => setDraft((d) => { const n = clone(d); n['earnedLeave'].treatment[st] = e.target.value; return n; })}>
                      {['COUNT', 'HALF', 'SKIP'].map((o) => <option key={o} value={o}>{t(`policy.treatmentOptions.${o}` as never)}</option>)}
                    </Select>
                  </FormField>
                ))}
              </div>
            </div>
          )}
          {s.key === 'general' && (
            <fieldset className="mt-4">
              <legend className="mb-1 text-sm font-semibold text-ink">{t('policy.weeklyOff')}</legend>
              <div className="flex flex-wrap gap-x-4">
                {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                  const cur = (draft['weeklyOffDays'] ?? []) as number[];
                  return <Checkbox key={day} label={t(`policy.weekday.${day}` as never)} disabled={!canEdit} checked={cur.includes(day)} onCheckedChange={(c) => setDraft((d) => ({ ...d, weeklyOffDays: c === true ? [...new Set([...cur, day])].sort() : cur.filter((x) => x !== day) }))} />;
                })}
              </div>
            </fieldset>
          )}
        </Panel>
      ))}
      {invalid.length > 0 && <Alert tone="danger">{t('policy.fixErrors')}</Alert>}
      <MutationAlert error={patch.error} />
      {fieldErrors.length > 0 && (
        <Alert tone="danger" title={t('policy.serverErrors')}>
          <ul className="list-disc pl-5">{fieldErrors.map(([p, m]) => <li key={p}><code>{p}</code>: {m}</li>)}</ul>
        </Alert>
      )}
      {canEdit && (
        <div className="sticky bottom-16 flex flex-wrap justify-end gap-2 rounded-lg border border-line bg-surface p-3 shadow-sm md:bottom-4">
          <Button variant="ghost" onClick={restoreDefaults}>{t('policy.restore')}</Button>
          <Button className="glow-gold glow-hover" loading={patch.isPending} onClick={save}>{t('policy.save')}</Button>
        </div>
      )}
    </div>
  );
}
