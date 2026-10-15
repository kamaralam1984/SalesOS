'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import { Button, FormField, PageHeader, Pagination, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { ConfirmDialog, QueryState } from '@/features/people/hub/shared';
import { useDecideLeave, useLeaveRequests, type LeaveRequest, type LeaveView } from '@/lib/api/hooks/work-leave';
import { RequestCard } from './leave-page';

export function ApprovalsPage() {
  return (
    <RequirePermission permission={['leave:approve', 'leave:approve-hr']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('workApprovals');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Tabs defaultValue="pending">
        <TabsList aria-label={t('tabs.label')}>
          <TabsTrigger value="pending">{t('tabs.pending')}</TabsTrigger>
          <TabsTrigger value="all">{t('tabs.all')}</TabsTrigger>
        </TabsList>
        <TabsContent value="pending"><List view="pending-me" /></TabsContent>
        <TabsContent value="all"><List view="team" /></TabsContent>
      </Tabs>
    </>
  );
}

function List({ view }: { view: Extract<LeaveView, 'pending-me' | 'team'> }) {
  const t = useTranslations('workApprovals');
  const tc = useTranslations('common');
  const { toast } = useToast();
  const { can } = useAuth();
  const [page, setPage] = React.useState(1);
  const [acting, setActing] = React.useState<{ r: LeaveRequest; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [comment, setComment] = React.useState('');
  const q = useLeaveRequests({ view: can('leave:view', 'org') && view === 'team' ? 'all' : view, page, limit: 10 });
  const decide = useDecideLeave();
  const isReject = acting?.decision === 'REJECT';
  return (
    <div className="enter-up mt-4 min-w-0 max-w-full">
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={view === 'pending-me' ? t('emptyPending') : t('emptyAll')} emptyDescription={view === 'pending-me' ? t('emptyPendingBody') : undefined}>
        <ul className="stagger space-y-2" aria-label={view === 'pending-me' ? t('tabs.pending') : t('tabs.all')}>
          {(q.data?.items ?? []).map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              showPerson
              actions={
                r.can.decide ? (
                  <>
                    <Button size="sm" className="glow-green glow-hover" leadingIcon={<Check aria-hidden="true" />} onClick={() => { setComment(''); setActing({ r, decision: 'APPROVE' }); }}>{t('approve')}</Button>
                    <Button size="sm" variant="secondary" leadingIcon={<X aria-hidden="true" />} onClick={() => { setComment(''); setActing({ r, decision: 'REJECT' }); }}>{t('reject')}</Button>
                  </>
                ) : undefined
              }
            />
          ))}
        </ul>
        {(q.data?.hasMore || page > 1) && (
          <Pagination className="mt-4" page={page} hasNext={Boolean(q.data?.hasMore)} onPageChange={setPage} labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }} />
        )}
      </QueryState>
      {acting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setActing(null)}
          title={isReject ? t('rejectTitle', { name: acting.r.userName ?? '' }) : t('approveTitle', { name: acting.r.userName ?? '' })}
          description={isReject ? t('rejectBody') : t('approveBody')}
          confirmLabel={isReject ? t('reject') : t('approve')}
          danger={isReject}
          pending={decide.isPending}
          error={decide.error}
          disabled={isReject && comment.trim().length < 3}
          onConfirm={() =>
            decide.mutate(
              { id: acting.r.id, decision: acting.decision, comment: comment.trim() || undefined },
              { onSuccess: () => { toast({ tone: 'success', title: isReject ? t('rejected') : t('approved') }); setActing(null); } },
            )
          }
        >
          <FormField label={isReject ? t('commentRequired') : t('commentOptional')} required={isReject}><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></FormField>
        </ConfirmDialog>
      )}
    </div>
  );
}
