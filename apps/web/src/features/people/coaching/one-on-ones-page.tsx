'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button, Dialog, DialogContent, FormField, PageHeader, Pagination, Select } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState } from '../hub/shared';
import { useOneOnOnes } from './api';
import { OneOnOneCard } from './one-on-one-card';
import { OneOnOneForm } from './one-on-one-form';

export function OneOnOnesPage() {
  return (
    <RequirePermission permission="coaching:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('coaching');
  const tc = useTranslations('common');
  const { can, user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useOneOnOnes({ page, limit: 10, status: status || undefined });
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('oneOnOnes.title')}
        description={t('oneOnOnes.description')}
        actions={can('coaching:create') ? <Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('oneOnOnes.new')}</Button> : undefined}
      />
      <FormField label={t('filters.status')} className="mb-4 w-52">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t('filters.any')}</option>
          {(['SCHEDULED', 'HELD', 'CANCELLED'] as const).map((s) => (
            <option key={s} value={s}>{t(`oneStatus.${s}` as never)}</option>
          ))}
        </Select>
      </FormField>
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('oneOnOnes.empty')} emptyDescription={t('oneOnOnes.emptyBody')}>
        <div className="stagger space-y-3">
          {(q.data?.items ?? []).map((item) => (
            <OneOnOneCard key={item.id} item={item} meId={user?.id} />
          ))}
        </div>
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
        <DialogContent title={t('oneOnOnes.formTitle')} description={t('oneOnOnes.formDescription')} size="lg" closeLabel={t('form.cancel')}>
          {open && <OneOnOneForm onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
