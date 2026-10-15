'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, PhoneCall } from 'lucide-react';
import { Alert, Badge, Button, DatePicker, Dialog, DialogContent, FormField, Input, Select, Textarea, cn } from '@salesos/ui';
import { useLeadMeta, useLogCall, type CallResult, type Lead } from '@/lib/api/hooks/crm';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useFieldError } from '@/hooks/use-field-error';
import { useCrmFormat } from './common';
import { clearPendingCall } from './pending-call';
import { dispositionSchema, needsNextAction, quickPick, toCallBody, type DispositionValues, type QuickPick } from './lib';
import { Hint } from '@/features/hints/hint-views';

type LeadRef = Pick<Lead, 'id' | 'fullName'> & { phone?: string | null };

export function DispositionDialog({
  open,
  onOpenChange,
  lead,
  taskId,
  defaultOutcome,
  prompt,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: LeadRef;
  taskId?: string;
  defaultOutcome?: DispositionValues['outcome'];
  /** shown above the form, e.g. when returning from the dialer */
  prompt?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <DispositionBody lead={lead} taskId={taskId} defaultOutcome={defaultOutcome} onOpenChange={onOpenChange} prompt={prompt} />}
    </Dialog>
  );
}

const PICKS: QuickPick[] = ['plus3h', 'tomorrow10', 'plus2d'];

export function DispositionBody({
  lead,
  taskId,
  defaultOutcome,
  onOpenChange,
  prompt,
}: {
  prompt?: string;
  lead: LeadRef;
  taskId?: string;
  defaultOutcome?: DispositionValues['outcome'];
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('crm.disposition');
  const tc = useTranslations('common');
  const tObj = useTranslations('crm.objection');
  const tOut = useTranslations('crm.outcome');
  const tTask = useTranslations('crm.taskType');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const f = useCrmFormat();
  const meta = useLeadMeta();
  const log = useLogCall();
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CallResult | null>(null);
  // one key per opened form: a double tap or a network retry can never log the call twice
  const [key] = React.useState(() => `ui-call-${Math.random().toString(36).slice(2)}-${Date.now()}`);

  const schema = React.useMemo(
    () => dispositionSchema({ lostNoteRequired: (r) => Boolean(meta.data?.lostReasons.find((x) => x.key === r)?.requiresNote) }),
    [meta.data],
  );
  const form = useForm<DispositionValues>({
    resolver: zodResolver(schema),
    defaultValues: { outcome: defaultOutcome ?? 'CONNECTED', notes: '', interestLevel: '', objectionCategory: '', nextActionAt: '', nextActionType: 'FOLLOW_UP', callbackAt: '', lostReason: '', lostNote: '', wonValue: '' },
  });
  const outcome = form.watch('outcome');
  const errs = form.formState.errors;

  async function submit(v: DispositionValues) {
    setError(null);
    try {
      setResult(await log.mutateAsync({ leadId: lead.id, body: toCallBody(v, taskId) as never, key }));
      clearPendingCall(lead.id);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }

  if (result) {
    return (
      <DialogContent
        size="md"
        title={t('savedTitle')}
        closeLabel={tc('close')}
        footer={<Button onClick={() => onOpenChange(false)}>{t('done')}</Button>}
      >
        <div className="enter-scale space-y-4" role="status">
          <p className="flex items-center gap-2 text-sm font-medium text-green-700">
            <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
            {t('savedBody', { name: lead.fullName })}
          </p>
          <p className="text-sm text-muted">
            <Badge tone="neutral">{t('manualBadge')}</Badge> {t('manualHint')}
          </p>
          {result.statusChanges.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">{t('statusChanged')}</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">
                {result.statusChanges.map((s, i) => (
                  <li key={i}>{`${s.from} → ${s.to}`}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold">{t('tasksCreated')}</h3>
            {result.tasksCreated.length ? (
              <ul className="mt-1 space-y-1 text-sm text-ink-700">
                {result.tasksCreated.map((x) => (
                  <li key={x.id}>
                    {x.title} <span className="text-muted">· {f.dateTime(x.dueAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t('noTasks')}</p>
            )}
          </div>
          {result.warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
        </div>
      </DialogContent>
    );
  }

  const setPick = (name: 'nextActionAt' | 'callbackAt', p: QuickPick) => form.setValue(name, quickPick(p), { shouldValidate: true, shouldDirty: true });
  const picks = (name: 'nextActionAt' | 'callbackAt') => (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap [&>*]:shrink-0" role="group" aria-label={t('quickPicks')}>
      {PICKS.map((p) => (
        <Button key={p} type="button" size="sm" variant="secondary" onClick={() => setPick(name, p)}>
          {t(`pick.${p}`)}
        </Button>
      ))}
    </div>
  );
  const dateField = (name: 'nextActionAt' | 'callbackAt', label: string, required: boolean) => (
    <FormField label={label} error={fe(errs[name])} required={required}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => <DatePicker mode="datetime-local" value={field.value ?? ''} onValueChange={field.onChange} />}
      />
    </FormField>
  );

  return (
    <DialogContent
      size="lg"
      title={t('title', { name: lead.fullName })}
      description={t('description')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="disposition-form" className="glow-gold" loading={log.isPending} loadingLabel={tc('saving')} leadingIcon={<PhoneCall className="size-4" aria-hidden="true" />}>
            {t('save')}
          </Button>
        </>
      }
    >
      <form id="disposition-form" onSubmit={form.handleSubmit(submit)} noValidate className="space-y-5">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone="neutral">{t('manualBadge')}</Badge>
          {t('manualHint')}
          <Hint id="manualCallLabel" />
        </p>
        {prompt && <Alert tone="info">{prompt}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">
            {t('outcome')} <Hint id="callOutcome" />
            {outcome === 'NO_ANSWER' && <Hint id="callNoAnswer" />}
          </legend>
          <div className="stagger-fast grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(meta.data?.callOutcomes ?? FALLBACK_OUTCOMES).map((o) => (
              <label
                key={o.key}
                className={cn(
                  'flex min-h-12 cursor-pointer items-center justify-center rounded-md border px-2 text-center text-sm font-medium transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.97] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
                  outcome === o.key ? 'border-gold-500 bg-gold-50 text-ink shadow-[var(--tone-glow-gold)]' : 'border-line-strong bg-surface text-ink-700 hover:bg-ivory-200',
                )}
              >
                <input type="radio" value={o.key} className="sr-only" {...form.register('outcome')} />
                {tOut(o.key as 'CONNECTED')}
              </label>
            ))}
          </div>
        </fieldset>

        {(outcome === 'CONNECTED' || outcome === 'CALLBACK' || outcome === 'WON' || outcome === 'LOST') && (
          <FormField label={t('interest')} error={fe(errs.interestLevel)} required={outcome === 'CONNECTED'}>
            <Select {...form.register('interestLevel')}>
              <option value="">{t('choose')}</option>
              <option value="LOW">{t('interestLOW')}</option>
              <option value="MEDIUM">{t('interestMEDIUM')}</option>
              <option value="HIGH">{t('interestHIGH')}</option>
            </Select>
          </FormField>
        )}

        {(outcome === 'CONNECTED' || outcome === 'LOST' || outcome === 'CALLBACK') && (
          <FormField label={t('objection')}>
            <Select {...form.register('objectionCategory')}>
              <option value="">{t('none')}</option>
              {(meta.data?.objectionCategories ?? []).map((o) => (
                <option key={o.key} value={o.key}>
                  {tObj(o.key as 'PRICE')}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        {(outcome === 'CALLBACK' || outcome === 'BUSY') && (
          <div className="space-y-2">
            {dateField('callbackAt', outcome === 'CALLBACK' ? t('callbackAt') : t('busyCallbackAt'), outcome === 'CALLBACK')}
            {picks('callbackAt')}
            {outcome === 'BUSY' && <p className="text-xs text-muted">{t('busyHint')}</p>}
          </div>
        )}

        {needsNextAction(outcome) && (
          <div className="space-y-2">
            {dateField('nextActionAt', t('nextActionAt'), outcome === 'CONNECTED')}
            {picks('nextActionAt')}
            {outcome !== 'CONNECTED' && <p className="text-xs text-muted">{t('autoRetryHint')}</p>}
            {outcome === 'CONNECTED' && (
              <FormField label={t('nextActionType')}>
                <Select {...form.register('nextActionType')}>
                  {(meta.data?.taskTypes ?? [])
                    .filter((x) => !['CALLBACK', 'ONBOARDING', 'MANAGER_REVIEW', 'WEBINAR_REMINDER'].includes(x.key))
                    .map((x) => (
                      <option key={x.key} value={x.key}>
                        {tTask(x.key as 'CALL')}
                      </option>
                    ))}
                </Select>
              </FormField>
            )}
          </div>
        )}

        {outcome === 'LOST' && (
          <>
            <FormField label={t('lostReason')} error={fe(errs.lostReason)} required info={<Hint id="callLost" />}>
              <Select {...form.register('lostReason')}>
                <option value="">{t('choose')}</option>
                {(meta.data?.lostReasons ?? []).map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('lostNote')} error={fe(errs.lostNote)}>
              <Textarea rows={2} {...form.register('lostNote')} />
            </FormField>
            <Alert tone="info">{t('lostHint')}</Alert>
          </>
        )}

        {outcome === 'WON' && (
          <FormField label={t('wonValue')} error={fe(errs.wonValue)} required hint={t('wonHint')} info={<Hint id="callWon" />}>
            <Input inputMode="decimal" {...form.register('wonValue')} />
          </FormField>
        )}

        <FormField label={t('notes')} error={fe(errs.notes)}>
          <Textarea rows={3} {...form.register('notes')} />
        </FormField>
        <p className="sr-only" aria-live="polite">
          {Object.keys(errs).length ? t('fixErrors') : ''}
        </p>
      </form>
    </DialogContent>
  );
}

const FALLBACK_OUTCOMES = ['CONNECTED', 'NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'CALLBACK', 'FAILED', 'WON', 'LOST'].map((k) => ({ key: k, label: k }));
