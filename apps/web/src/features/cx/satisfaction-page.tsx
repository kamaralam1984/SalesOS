'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquareHeart, Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Pagination, Panel, Select, Stat, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ck, useAction, useList, useOne, type SatisfactionRow, type SatisfactionStats, type SurveyQuestion, type SurveyTemplate } from './api';
import { LeadPicker, type PickedLead } from './lead-picker';
import { ListShell, useFmt, usePaginationLabels } from './shared';

const KINDS = ['CSAT', 'NPS', 'ENROLMENT_EXPERIENCE'] as const;
type Kind = (typeof KINDS)[number];

export function SatisfactionPage() {
  return (
    <RequirePermission permission="satisfaction:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('cx');
  const [tab, setTab] = React.useState('results');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('satisfaction.title')} description={t('satisfaction.description')} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('satisfaction.tabs')}>
          <TabsTrigger value="results">{t('satisfaction.tabResults')}</TabsTrigger>
          <Can permission="satisfaction:create"><TabsTrigger value="capture">{t('satisfaction.tabCapture')}</TabsTrigger></Can>
          <TabsTrigger value="templates">{t('satisfaction.tabTemplates')}</TabsTrigger>
        </TabsList>
        <TabsContent value="results"><Results /></TabsContent>
        <TabsContent value="capture"><Capture onDone={() => setTab('results')} /></TabsContent>
        <TabsContent value="templates"><Templates /></TabsContent>
      </Tabs>
    </>
  );
}

function Results() {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const labels = usePaginationLabels();
  const [kind, setKind] = React.useState('');
  const [page, setPage] = React.useState(1);
  const stats = useOne<SatisfactionStats>(ck('satisfaction', 'stats'), '/cx/satisfaction/stats', {});
  const list = useList<SatisfactionRow>(ck('satisfaction', 'list'), '/cx/satisfaction', { page, limit: 12, kind: kind || undefined });
  return (
    <div className="space-y-6">
      <ListShell query={stats} skeletons={1}>
        <div className="stagger grid gap-3 sm:grid-cols-3">
          {stats.data?.summaries.map((s) => (
            <Panel accent="gold" key={s.kind} title={t(`survey.kind.${s.kind}` as never)} headingLevel={3}>
              {s.n === 0 ? <p className="text-sm text-muted">{t('satisfaction.noResponses')}</p> : (
                <div className="space-y-2">
                  <Stat label={s.kind === 'NPS' ? t('satisfaction.nps') : t('satisfaction.mean')} value={s.kind === 'NPS' ? (s.nps ?? t('common.dash')) : (s.mean ?? t('common.dash'))} hint={t('satisfaction.responses', { n: s.n })} />
                  {s.kind !== 'NPS' && s.satisfiedPct != null && <p className="text-sm text-ink-700">{t('satisfaction.satisfied', { pct: s.satisfiedPct })}</p>}
                  {s.lowSample && <Badge tone="gold">{t('satisfaction.lowSample')}</Badge>}
                  {s.excludedOutsideWindow > 0 && <p className="text-xs text-muted">{t('satisfaction.excluded', { n: s.excludedOutsideWindow })}</p>}
                </div>
              )}
            </Panel>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{stats.data?.note}</p>
      </ListShell>
      <section aria-label={t('satisfaction.responsesList')}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-ink">{t('satisfaction.responsesList')}</h2>
          <div className="w-full sm:w-56"><FormField label={t('satisfaction.kind')} hideLabel><Select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}><option value="">{t('satisfaction.allKinds')}</option>{KINDS.map((k) => <option key={k} value={k}>{t(`survey.kind.${k}`)}</option>)}</Select></FormField></div>
        </div>
        <ListShell query={list} skeletons={3}>
          {list.data && list.data.items.length === 0 ? (
            <EmptyState icon={<MessageSquareHeart className="size-6" aria-hidden="true" />} title={t('satisfaction.empty')} description={t('satisfaction.emptyHint')} />
          ) : (
            <>
              <ul className="stagger grid gap-3 md:grid-cols-2">
                {list.data?.items.map((r) => (
                  <li key={r.id} className="hover-lift rounded-lg border border-line bg-surface p-4 shadow-xs">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone="blue">{t(`survey.kind.${r.kind}` as never)}</Badge>
                      <span className="kpi-number font-display text-xl font-semibold text-ink">{r.score}<span className="text-sm font-normal text-muted">/{r.kind === 'NPS' ? 10 : 5}</span></span>
                      {r.outsideWindow && <Badge tone="gold">{t('satisfaction.outsideWindow')}</Badge>}
                    </div>
                    {r.comment && <p className="text-sm text-ink-700">{r.comment}</p>}
                    <p className="mt-1.5 text-xs text-muted">{r.respondentName ?? r.respondentRef ?? '—'} · {fmt.dateTime(r.respondedAt)} · {t(`survey.channel.${r.channel}` as never)} · {t('satisfaction.consented', { at: fmt.date(r.consentAt) })}</p>
                  </li>
                ))}
              </ul>
              <Pagination className="mt-5" page={page} hasNext={Boolean(list.data?.pagination?.hasMore)} onPageChange={setPage} labels={labels} />
            </>
          )}
        </ListShell>
      </section>
      <span className="sr-only">{tc('loading')}</span>
    </div>
  );
}

function Capture({ onDone }: { onDone: () => void }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const { toast } = useToast();
  const apiErr = useApiErrorMessage();
  const templates = useOne<SurveyTemplate[]>(ck('survey-templates'), '/cx/survey-templates');
  const create = useAction<Record<string, unknown>>('post', '/cx/satisfaction');
  const [kind, setKind] = React.useState<Kind>('CSAT');
  const [lead, setLead] = React.useState<PickedLead | null>(null);
  const [ref, setRef] = React.useState('');
  const [name, setName] = React.useState('');
  const [channel, setChannel] = React.useState('PHONE');
  const [answers, setAnswers] = React.useState<Record<string, string | number | boolean>>({});
  const [consent, setConsent] = React.useState(false);
  const tpl = templates.data?.find((x) => x.kind === kind && x.isActive);
  const questions = tpl?.questions ?? [];
  const missing = questions.filter((q) => q.required && (answers[q.id] === undefined || answers[q.id] === ''));
  const noRespondent = !lead && ref.trim().length === 0;
  const blocked = !consent || missing.length > 0 || noRespondent || !tpl;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked || !tpl) return;
    create.mutate(
      {
        kind, ...(tpl.id ? { templateId: tpl.id } : {}), ...(lead ? { leadId: lead.id } : {}), ...(ref.trim() ? { respondentRef: ref.trim() } : {}), ...(name.trim() ? { respondentName: name.trim() } : {}),
        answers: Object.entries(answers).filter(([, v]) => v !== '').map(([questionId, value]) => ({ questionId, value })), consentGiven: true, channel,
      },
      { onSuccess: () => { toast({ title: t('satisfaction.saved'), tone: 'success' }); setAnswers({}); setConsent(false); setLead(null); setRef(''); setName(''); onDone(); } },
    );
  };
  if (templates.isPending) return <p className="text-sm text-muted" role="status">{tc('loading')}</p>;
  if (templates.isError) return <Alert tone="danger">{apiErr(templates.error).message}</Alert>;
  return (
    <form className="mx-auto max-w-2xl space-y-5" onSubmit={submit} aria-label={t('satisfaction.tabCapture')}>
      <p className="text-sm text-muted">{t('satisfaction.captureHint')}</p>
      {create.isError && <Alert tone="danger">{apiErr(create.error).message}</Alert>}
      <FormField label={t('satisfaction.kind')} required>
        <Select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setAnswers({}); }}>{KINDS.map((k) => <option key={k} value={k}>{t(`survey.kind.${k}`)}</option>)}</Select>
      </FormField>
      <LeadPicker value={lead} onChange={setLead} label={t('satisfaction.learner')} hint={t('satisfaction.learnerHint')} />
      {!lead && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('satisfaction.respondentRef')} required hint={t('satisfaction.respondentRefHint')}><Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} /></FormField>
          <FormField label={t('satisfaction.respondentName')}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></FormField>
        </div>
      )}
      <FormField label={t('satisfaction.channel')}>
        <Select value={channel} onChange={(e) => setChannel(e.target.value)}>{['MANUAL', 'PHONE', 'WHATSAPP', 'EMAIL', 'IN_PERSON'].map((c) => <option key={c} value={c}>{t(`survey.channel.${c}`)}</option>)}</Select>
      </FormField>
      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">{tpl ? tpl.name : t('satisfaction.noTemplate')}{tpl?.builtin ? ` (${t('satisfaction.builtin')})` : ''}</legend>
        {questions.map((q) => <Question key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswers((p) => ({ ...p, [q.id]: v }))} />)}
      </fieldset>
      <label className="flex items-start gap-2.5 text-sm text-ink">
        <input type="checkbox" className="mt-0.5 size-4 accent-gold-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span><span className="font-medium">{t('satisfaction.consent')}</span><span className="mt-0.5 block text-muted">{t('satisfaction.consentHint')}</span></span>
      </label>
      <Button type="submit" loading={create.isPending} disabled={blocked}>{t('satisfaction.save')}</Button>
    </form>
  );
}

function Question({ q, value, onChange }: { q: SurveyQuestion; value: string | number | boolean | undefined; onChange: (v: string | number | boolean) => void }) {
  const t = useTranslations('cx');
  if (q.type === 'TEXT') return <FormField label={q.text} required={q.required}><Textarea rows={3} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} maxLength={2000} /></FormField>;
  if (q.type === 'YES_NO') {
    return (
      <fieldset><legend className="mb-1.5 text-sm font-medium text-ink">{q.text}{q.required && <span aria-hidden="true" className="ml-0.5 text-gold-700">*</span>}</legend>
        <div className="flex gap-2">{[true, false].map((b) => <Button key={String(b)} type="button" size="sm" variant={value === b ? 'primary' : 'secondary'} aria-pressed={value === b} onClick={() => onChange(b)}>{b ? t('satisfaction.yes') : t('satisfaction.no')}</Button>)}</div>
      </fieldset>
    );
  }
  const range = q.type === 'NPS_0_10' ? Array.from({ length: 11 }, (_, i) => i) : [1, 2, 3, 4, 5];
  return (
    <fieldset><legend className="mb-1.5 text-sm font-medium text-ink">{q.text}{q.required && <span aria-hidden="true" className="ml-0.5 text-gold-700">*</span>}</legend>
      <div className="flex flex-wrap gap-2">{range.map((n) => <Button key={n} type="button" size="sm" variant={value === n ? 'primary' : 'secondary'} aria-pressed={value === n} aria-label={`${n}`} onClick={() => onChange(n)} className="min-w-10">{n}</Button>)}</div>
      <p className="mt-1 text-xs text-muted">{q.type === 'NPS_0_10' ? t('satisfaction.npsScale') : t('satisfaction.ratingScale')}</p>
    </fieldset>
  );
}

function Templates() {
  const t = useTranslations('cx');
  const query = useOne<SurveyTemplate[]>(ck('survey-templates'), '/cx/survey-templates');
  const [open, setOpen] = React.useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">{t('satisfaction.templatesHint')}</p>
        <Can permission="settings:update"><Button onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden="true" />{t('satisfaction.newTemplate')}</Button></Can>
      </div>
      <ListShell query={query} skeletons={2}>
        <ul className="stagger grid gap-3 md:grid-cols-2">
          {query.data?.map((x) => (
            <li key={x.key} className="hover-lift rounded-lg border border-line bg-surface p-4 shadow-xs">
              <div className="mb-1.5 flex flex-wrap items-center gap-2"><Badge tone="blue">{t(`survey.kind.${x.kind}` as never)}</Badge>{x.builtin ? <Badge>{t('satisfaction.builtin')}</Badge> : <Badge tone={x.isActive ? 'green' : 'neutral'}>{x.isActive ? t('satisfaction.active') : t('satisfaction.inactive')}</Badge>}{!x.builtin && <span className="text-xs text-muted">v{x.version}</span>}</div>
              <p className="font-medium text-ink">{x.name}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-700">{x.questions.map((q) => <li key={q.id}>{q.text} <span className="text-xs text-muted">({t(`survey.qtype.${q.type}` as never)}{q.required ? `, ${t('satisfaction.required')}` : ''})</span></li>)}</ol>
            </li>
          ))}
        </ul>
      </ListShell>
      <TemplateDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function TemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('cx');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('satisfaction.newTemplate')} description={t('satisfaction.templateDescription')} closeLabel={t('common.close')} size="lg">
        {open && <TemplateForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function TemplateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const create = useAction<Record<string, unknown>>('post', '/cx/survey-templates');
  const [kind, setKind] = React.useState<Kind>('CSAT');
  const [key, setKey] = React.useState('');
  const [name, setName] = React.useState('');
  const [qs, setQs] = React.useState<SurveyQuestion[]>([{ id: 'overall', text: '', type: 'RATING_1_5', required: true }]);
  const headline = kind === 'NPS' ? 'NPS_0_10' : 'RATING_1_5';
  const valid = /^[a-z0-9_-]{2,60}$/i.test(key) && name.trim().length >= 3 && qs.every((q) => q.text.trim().length >= 3 && /^[a-z0-9_-]+$/i.test(q.id)) && qs.some((q) => q.type === headline && q.required) && new Set(qs.map((q) => q.id)).size === qs.length;
  const upd = (i: number, patch: Partial<SurveyQuestion>) => setQs((p) => p.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate({ key, name: name.trim(), kind, questions: qs.map((q) => ({ ...q, text: q.text.trim() })) }, { onSuccess: onDone }); }}>
      {create.isError && <Alert tone="danger">{apiErr(create.error).message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t('satisfaction.kind')} required><Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{KINDS.map((k) => <option key={k} value={k}>{t(`survey.kind.${k}`)}</option>)}</Select></FormField>
        <FormField label={t('satisfaction.templateKey')} required hint={t('satisfaction.templateKeyHint')}><Input value={key} onChange={(e) => setKey(e.target.value)} maxLength={60} /></FormField>
        <FormField label={t('satisfaction.templateName')} required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></FormField>
      </div>
      <Alert tone="info">{t('satisfaction.headlineHint', { type: t(`survey.qtype.${headline}` as never) })}</Alert>
      <ol className="space-y-3">
        {qs.map((q, i) => (
          <li key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[8rem_1fr_9rem_auto]">
            <FormField label={t('satisfaction.questionId')}><Input value={q.id} onChange={(e) => upd(i, { id: e.target.value })} maxLength={40} /></FormField>
            <FormField label={t('satisfaction.questionText')}><Input value={q.text} onChange={(e) => upd(i, { text: e.target.value })} maxLength={300} /></FormField>
            <FormField label={t('satisfaction.questionType')}><Select value={q.type} onChange={(e) => upd(i, { type: e.target.value as SurveyQuestion['type'] })}>{['RATING_1_5', 'NPS_0_10', 'YES_NO', 'TEXT'].map((x) => <option key={x} value={x}>{t(`survey.qtype.${x}`)}</option>)}</Select></FormField>
            <div className="flex items-end gap-2">
              <label className="flex min-h-11 items-center gap-1.5 text-sm"><input type="checkbox" className="size-4 accent-gold-600" checked={q.required} onChange={(e) => upd(i, { required: e.target.checked })} />{t('satisfaction.required')}</label>
              {qs.length > 1 && <Button type="button" variant="ghost" size="icon" aria-label={t('satisfaction.removeQuestion')} onClick={() => setQs((p) => p.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden="true" /></Button>}
            </div>
          </li>
        ))}
      </ol>
      <Button type="button" variant="secondary" onClick={() => setQs((p) => [...p, { id: `q${p.length + 1}`, text: '', type: 'TEXT', required: false }])}><Plus className="size-4" aria-hidden="true" />{t('satisfaction.addQuestion')}</Button>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={create.isPending} disabled={!valid}>{t('satisfaction.createTemplate')}</Button>
      </div>
    </form>
  );
}
