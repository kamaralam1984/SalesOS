'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, FormField, PageHeader, Pagination, Select } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState, RestrictedBanner, toneFor, useFormatDate } from '../hub/shared';
import { useReviews } from './api';
import { ReviewForm } from './review-form';

export function ReviewsPage() {
  return (
    <RequirePermission permission="reviews:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('performance');
  const tc = useTranslations('common');
  const fmt = useFormatDate();
  const router = useRouter();
  const { can } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useReviews({ page, limit: 10, status: status || undefined });
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('reviews.title')}
        description={t('reviews.description')}
        actions={can('reviews:create') ? <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('reviews.new')}</Button> : undefined}
      />
      <RestrictedBanner />
      <FormField label={t('reviews.status')} className="mb-4 w-52">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t('reviews.any')}</option>
          {(['DRAFT', 'SUBMITTED', 'APPROVED', 'ACKNOWLEDGED'] as const).map((s) => <option key={s} value={s}>{t(`status.${s}` as never)}</option>)}
        </Select>
      </FormField>
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('reviews.empty')} emptyDescription={t('reviews.emptyBody')}>
        <ul className="stagger space-y-2" aria-label={t('reviews.title')}>
          {(q.data?.items ?? []).map((r) => (
            <li key={r.id}>
              <Link href={`/people/reviews/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3.5 hover-lift focus-visible:outline-2 focus-visible:outline-focus">
                <span>
                  <span className="block font-medium text-ink">{r.employeeName ?? '—'}</span>
                  <span className="text-sm text-muted">{fmt.date(r.periodStart)} – {fmt.date(r.periodEnd)} · {t('reviews.reviewer')}: {r.reviewerName ?? '—'}</span>
                </span>
                <Badge tone={toneFor(r.status)}>{t(`status.${r.status}` as never)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
        {(q.data?.pagination?.hasMore || page > 1) && (
          <Pagination
            className="mt-4"
            page={page}
            hasPrev={page > 1}
            hasNext={Boolean(q.data?.pagination?.hasMore)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }}
          />
        )}
      </QueryState>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('review.newTitle')} description={t('review.newDescription')} size="lg" closeLabel={t('close')}>
          {open && <ReviewForm onDone={(id) => { setOpen(false); if (id) router.push(`/people/reviews/${id}`); }} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
