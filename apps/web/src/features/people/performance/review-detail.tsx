'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, Panel, PageHeader, Textarea, FormField, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { ConfirmDialog, MutationAlert, QueryState, RestrictedBanner, toneFor, useFormatDate } from '../hub/shared';
import { useCompetencies, useReview, useReviewAction } from './api';
import { REVIEW_STEPS, reviewActions } from './review-logic';
import { ReviewForm } from './review-form';

export function ReviewDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission="reviews:view">
      <Inner id={id} />
    </RequirePermission>
  );
}

function Inner({ id }: { id: string }) {
  const t = useTranslations('performance');
  const fmt = useFormatDate();
  const { user, can } = useAuth();
  const { toast } = useToast();
  const q = useReview(id);
  const comps = useCompetencies();
  const act = useReviewAction(id);
  const [edit, setEdit] = React.useState(false);
  const [confirm, setConfirm] = React.useState<'submit' | 'approve' | 'acknowledge' | null>(null);
  const [comment, setComment] = React.useState('');
  const r = q.data;
  const a = r ? reviewActions(r, user?.id, can) : null;
  const names = new Map((comps.data ?? []).map((c) => [c.key, c.name]));

  const run = async () => {
    if (!confirm) return;
    try {
      await act.mutateAsync({ action: confirm, comment: comment.trim() || undefined });
      toast({ tone: 'success', title: t(`review.done.${confirm}` as never) });
      setConfirm(null);
      setComment('');
    } catch {
      /* shown in dialog */
    }
  };

  return (
    <QueryState query={q} isEmpty={!r} emptyTitle={t('review.notFound')}>
      {r && a && (
        <>
          <PageHeader
            eyebrow={t('eyebrow')}
            title={t('review.detailTitle', { name: r.employeeName ?? '—' })}
            description={`${fmt.date(r.periodStart)} – ${fmt.date(r.periodEnd)} · ${t('reviews.reviewer')}: ${r.reviewerName ?? '—'}`}
            breadcrumbs={[{ label: t('reviews.title'), href: '/people/reviews' }, { label: r.employeeName ?? '—' }]}
            breadcrumbLabel={t('breadcrumb')}
            actions={
              <>
                {a.canEdit && <Button variant="secondary" onClick={() => setEdit(true)}>{t('review.edit')}</Button>}
                {a.canSubmit && <Button onClick={() => setConfirm('submit')}>{t('review.submit')}</Button>}
                {a.canApprove && <Button variant="gold" onClick={() => setConfirm('approve')}>{t('review.approve')}</Button>}
                {a.canAcknowledge && <Button onClick={() => setConfirm('acknowledge')}>{t('review.acknowledge')}</Button>}
              </>
            }
          />
          <RestrictedBanner />
          <ol className="mb-5 flex flex-wrap gap-2" aria-label={t('review.flow')}>
            {REVIEW_STEPS.map((s, i) => {
              const current = s === r.status;
              const passed = REVIEW_STEPS.indexOf(r.status) > i;
              return (
                <li key={s} aria-current={current ? 'step' : undefined}>
                  <Badge tone={current ? toneFor(s) : passed ? 'green' : 'neutral'} icon={passed ? <Check aria-hidden="true" className="size-3.5" /> : undefined}>
                    {i + 1}. {t(`status.${s}` as never)}
                  </Badge>
                </li>
              );
            })}
          </ol>
          {r.status === 'SUBMITTED' && !a.canApprove && <Alert tone="info" className="mb-4">{t('review.awaitingApproval')}</Alert>}
          <div className="enter-up grid gap-4 lg:grid-cols-2">
            <Panel accent="gold" title={t('review.competencies')}>
              {Object.keys(r.competencyScores).length === 0 ? (
                <p className="text-sm text-muted">{t('review.noScores')}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {Object.entries(r.competencyScores).map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between py-1.5">
                      <span className="text-ink">{names.get(k) ?? k}</span>
                      <span className="font-semibold text-ink" aria-label={t('review.scoreOutOf', { n: v })}>{v}/5</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-sm"><span className="font-medium text-ink">{t('review.rating')}: </span>{r.rating ? `${r.rating}/5` : '—'}</p>
            </Panel>
            <Panel accent="blue" title={t('review.narrative')}>
              {[['strengths', r.strengths], ['improvements', r.improvements], ['goals', r.goals]].map(([k, v]) => (
                <div key={k} className="mb-3 last:mb-0">
                  <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{t(`review.${k}` as never)}</h3>
                  <p className="text-sm whitespace-pre-wrap text-ink">{v || '—'}</p>
                </div>
              ))}
            </Panel>
          </div>
          {(r.approvedAt || r.acknowledgedAt || r.employeeComment) && (
            <Panel accent="green" className="mt-4" title={t('review.sign')}>
              <ul className="space-y-1 text-sm">
                {r.approvedAt && <li>{t('review.approvedBy', { name: r.approvedByName ?? '—', date: fmt.dateTime(r.approvedAt) })}</li>}
                {r.acknowledgedAt && <li>{t('review.acknowledgedAt', { date: fmt.dateTime(r.acknowledgedAt) })}</li>}
                {r.employeeComment && <li><span className="font-medium">{t('review.employeeComment')}: </span>{r.employeeComment}</li>}
              </ul>
            </Panel>
          )}
          <Dialog open={edit} onOpenChange={setEdit}>
            <DialogContent title={t('review.editTitle')} size="lg" closeLabel={t('close')}>
              {edit && <ReviewForm existing={r} onDone={() => setEdit(false)} />}
            </DialogContent>
          </Dialog>
          <ConfirmDialog
            open={confirm !== null}
            onOpenChange={(o) => !o && setConfirm(null)}
            title={confirm ? t(`review.confirm.${confirm}.title` as never) : ''}
            description={confirm ? t(`review.confirm.${confirm}.body` as never) : ''}
            confirmLabel={confirm ? t(`review.confirm.${confirm}.action` as never) : ''}
            pending={act.isPending}
            error={act.error}
            onConfirm={() => void run()}
          >
            {confirm === 'acknowledge' && (
              <FormField label={t('review.employeeComment')}><Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></FormField>
            )}
          </ConfirmDialog>
          <MutationAlert error={null} />
        </>
      )}
    </QueryState>
  );
}
