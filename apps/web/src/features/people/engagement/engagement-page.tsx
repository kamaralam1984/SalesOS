'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Dialog, DialogContent, EmptyState, ErrorState, FormField, Input, PageHeader, Panel, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@salesos/ui';
import { Can, usePermission } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useDone } from '../hrkit/kit';
import { useCreateSurvey, useOpenSurveys, useRespond, useSurveyResults, type OpenSurvey } from './api';
import { ResultsView } from './results-view';

export function EngagementPage() {
  return (
    <RequirePermission permission={['engagement:respond', 'engagement:view']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('engagement');
  const canResults = usePermission('engagement:view');
  const canRespond = usePermission('engagement:respond');
  const [creating, setCreating] = React.useState(false);
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} actions={<Can permission="hr:records:manage"><Button onClick={() => setCreating(true)}>{t('create.open')}</Button></Can>} />
      <Alert tone="info" className="enter-fade mb-5" live={false}>{t('anonymity')}</Alert>
      <Tabs defaultValue={canRespond ? 'respond' : 'results'}>
        <TabsList aria-label={t('title')}>
          {canRespond && <TabsTrigger value="respond">{t('tabs.respond')}</TabsTrigger>}
          {canResults && <TabsTrigger value="results">{t('tabs.results')}</TabsTrigger>}
        </TabsList>
        {canRespond && <TabsContent value="respond"><RespondTab /></TabsContent>}
        {canResults && <TabsContent value="results"><ResultsTab /></TabsContent>}
      </Tabs>
      <Dialog open={creating} onOpenChange={setCreating}>{creating && <CreateSurvey onClose={() => setCreating(false)} />}</Dialog>
    </>
  );
}

function RespondTab() {
  const t = useTranslations('engagement');
  const apiErr = useApiErrorMessage();
  const q = useOpenSurveys();
  if (q.isPending) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} />;
  if (q.data.length === 0) return <EmptyState title={t('respond.emptyTitle')} description={t('respond.emptyBody')} />;
  return <div className="stagger space-y-4">{q.data.map((s) => <SurveyCard key={s.id} s={s} />)}</div>;
}

function SurveyCard({ s }: { s: OpenSurvey }) {
  const t = useTranslations('engagement');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const respond = useRespond();
  const [answers, setAnswers] = React.useState<Record<string, number | string>>({});
  const [submitted, setSubmitted] = React.useState(false);
  if (s.answered || submitted) return <Panel accent="gold" title={s.title}><p className="text-sm text-ink-600">{t('respond.thanks')}</p></Panel>;
  const ready = s.questions.filter((q) => q.type === 'SCALE_5').every((q) => typeof answers[q.id] === 'number');
  const payload = Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== ''));
  return (
    <Panel accent="blue" title={s.title} description={t('respond.hint')}>
      <form onSubmit={(e) => { e.preventDefault(); respond.mutate({ surveyId: s.id, answers: payload }, { onSuccess: () => { done(t('respond.sent')); setSubmitted(true); } }); }} className="space-y-4">
        {respond.isError && <Alert tone="danger">{apiErr(respond.error).message}</Alert>}
        {s.questions.map((q) => q.type === 'SCALE_5' ? (
          <fieldset key={q.id}>
            <legend className="mb-1.5 text-sm font-medium text-ink">{q.text}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.text}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={`flex size-11 cursor-pointer items-center justify-center rounded-md border text-sm font-medium focus-within:ring-2 ${answers[q.id] === n ? 'border-gold-400 bg-gold-50 text-gold-700 glow-gold' : 'border-line-strong text-ink-600 transition-colors hover:border-gold-300'}`}>
                  <input type="radio" name={`${s.id}-${q.id}`} value={n} checked={answers[q.id] === n} onChange={() => setAnswers({ ...answers, [q.id]: n })} className="sr-only" />{n}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">{t('respond.scale')}</p>
          </fieldset>
        ) : (
          <FormField key={q.id} label={q.text}><Textarea rows={3} maxLength={2000} value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} /></FormField>
        ))}
        <Button type="submit" disabled={!ready} loading={respond.isPending}>{t('respond.submit')}</Button>
      </form>
    </Panel>
  );
}

function ResultsTab() {
  const t = useTranslations('engagement');
  const apiErr = useApiErrorMessage();
  const q = useSurveyResults(true);
  if (q.isPending) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} description={apiErr(q.error).message} />;
  if (q.data.length === 0) return <EmptyState title={t('results.emptyTitle')} description={t('results.emptyBody')} />;
  return <div className="stagger space-y-4">{q.data.map((r) => <ResultsView key={r.surveyId} result={r} />)}</div>;
}

function CreateSurvey({ onClose }: { onClose: () => void }) {
  const t = useTranslations('engagement');
  const apiErr = useApiErrorMessage();
  const done = useDone();
  const create = useCreateSurvey();
  const [title, setTitle] = React.useState('');
  const [qs, setQs] = React.useState<Array<{ text: string; type: 'SCALE_5' | 'TEXT' }>>([{ text: '', type: 'SCALE_5' }]);
  const valid = title.trim().length >= 3 && qs.length > 0 && qs.every((q) => q.text.trim().length >= 3);
  return (
    <DialogContent size="lg" title={t('create.title')} description={t('create.body')} footer={<><Button variant="secondary" onClick={onClose}>{t('cancel')}</Button><Button disabled={!valid} loading={create.isPending} onClick={() => create.mutate({ title, questions: qs.map((q, i) => ({ id: `q${i + 1}`, text: q.text.trim(), type: q.type })) }, { onSuccess: () => { done(t('create.done')); onClose(); } })}>{t('create.submit')}</Button></>}>
      {create.isError && <Alert tone="danger" className="mb-3">{apiErr(create.error).message}</Alert>}
      <FormField label={t('create.surveyTitle')} required><Input value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
      <div className="mt-3 space-y-2">
        {qs.map((q, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
            <FormField label={t('create.question', { n: i + 1 })}><Input value={q.text} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></FormField>
            <FormField label={t('create.type')}><Select value={q.type} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, type: e.target.value as 'SCALE_5' | 'TEXT' } : x)))}><option value="SCALE_5">{t('create.scale')}</option><option value="TEXT">{t('create.text')}</option></Select></FormField>
            <div className="flex items-end"><Button type="button" variant="ghost" disabled={qs.length === 1} onClick={() => setQs(qs.filter((_, j) => j !== i))}>{t('create.remove')}</Button></div>
          </div>
        ))}
        <Button type="button" size="sm" variant="secondary" onClick={() => setQs([...qs, { text: '', type: 'SCALE_5' }])}>{t('create.add')}</Button>
      </div>
    </DialogContent>
  );
}
