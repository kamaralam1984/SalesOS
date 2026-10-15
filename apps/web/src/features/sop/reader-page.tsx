'use client';
import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, FileDiff, History, Paperclip, Pencil, Plus, ShieldOff } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatusBadge, useToast } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { Can, usePermission } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useAckHistory, useAcknowledge, useRetireSop, useSopDoc, useSopVersion, type SopDetail } from './api';
import { SafeMarkdown } from './markdown';
import { useFmt, VersionStatusBadge } from './shared';
import { Hint } from '@/features/hints/hint-views';

export function ReaderPage() {
  return (
    <RequirePermission permission="sop:view">
      <ReaderInner />
    </RequirePermission>
  );
}

function ReaderInner() {
  const { id } = useParams<{ id: string }>();
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const doc = useSopDoc(id);
  if (doc.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label={tc('loading')} className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (doc.isError) {
    return <ErrorState description={apiErr(doc.error).message} requestId={apiErr(doc.error).requestId} onRetry={() => doc.refetch()} retryLabel={tc('retry')} />;
  }
  return <Reader doc={doc.data} />;
}

function Reader({ doc }: { doc: SopDetail }) {
  const t = useTranslations('sop');
  const tc = useTranslations('common');
  const fmt = useFmt();
  const router = useRouter();
  const search = useSearchParams();
  const { toast } = useToast();
  const apiErr = useApiErrorMessage();
  const canCreate = usePermission('sop:create');
  const canAck = usePermission('sop:acknowledge');
  const canAdoption = usePermission('sop:adoption:view');
  const ack = useAcknowledge();
  const retire = useRetireSop();
  const [confirmRetire, setConfirmRetire] = React.useState(false);

  const viewId = search.get('version');
  const selected = useSopVersion(viewId && viewId !== doc.effectiveVersionId ? viewId : null);
  const viewing = viewId && viewId !== doc.effectiveVersionId ? selected.data : doc.effectiveVersion;
  const isEffective = !viewing || viewing.id === doc.effectiveVersionId;
  const acks = useAckHistory(doc.id, canAdoption);
  const hasOpen = doc.versions.some((v) => ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(v.status));
  const openVersion = doc.versions.find((v) => ['DRAFT', 'REJECTED'].includes(v.status));
  const prevOf = (n: number) => doc.versions.find((v) => v.versionNumber === n - 1);

  const doAck = async () => {
    if (!doc.effectiveVersionId) return;
    try {
      await ack.mutateAsync(doc.effectiveVersionId);
      toast({ tone: 'success', title: t('reader.ackDone') });
    } catch (e) {
      toast({ tone: 'danger', title: t('reader.ackFailed'), description: apiErr(e).message });
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t(`categories.${doc.category}`)}
        title={doc.title}
        description={doc.summary ?? undefined}
        breadcrumbs={[{ label: t('library.title'), href: '/sop' }, { label: doc.title }]}
        breadcrumbLabel={tc('breadcrumb')}
        actions={
          <>
            {canCreate && doc.status === 'ACTIVE' && (hasOpen ? (
              openVersion ? <Button asChild variant="secondary"><Link href={`/sop/${doc.id}/edit?version=${openVersion.id}`}><Pencil className="size-4" aria-hidden="true" />{t('reader.editDraft')}</Link></Button> : null
            ) : (
              <Button asChild variant="secondary"><Link href={`/sop/${doc.id}/edit`}><Plus className="size-4" aria-hidden="true" />{t('reader.newVersion')}</Link></Button>
            ))}
            <Can permission="sop:approve">
              {doc.status === 'ACTIVE' && <Button variant="danger" leadingIcon={<ShieldOff className="size-4" aria-hidden="true" />} onClick={() => setConfirmRetire(true)}>{t('reader.retire')}</Button>}
            </Can>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          {doc.status === 'RETIRED' && <Alert tone="warning">{t('reader.retiredNotice')}</Alert>}
          {!isEffective && viewing && (
            <Alert tone="info" actions={<Button asChild size="sm" variant="secondary"><Link href={`/sop/${doc.id}`}>{t('reader.backToEffective')}</Link></Button>}>
              {t('reader.viewingOther', { version: viewing.versionNumber })}
            </Alert>
          )}
          {viewId && !isEffective && selected.isPending ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : viewId && !isEffective && selected.isError ? (
            <ErrorState description={apiErr(selected.error).message} onRetry={() => selected.refetch()} retryLabel={tc('retry')} />
          ) : viewing ? (
            <Panel accent="gold"
              title={t('reader.versionHeading', { version: viewing.versionNumber })}
              description={t('reader.versionMeta', { date: fmt.date(viewing.effectiveDate), author: viewing.createdByName ?? '—' })}
              actions={<VersionStatusBadge status={viewing.status} />}
            >
              {viewing.changeSummary && <p className="mb-4 rounded-md bg-ivory-200 px-3 py-2 text-sm text-ink-700"><strong>{t('reader.changeSummary')}:</strong> {viewing.changeSummary}</p>}
              {viewing.rejectionReason && <Alert tone="danger" title={t('reader.rejected')}>{viewing.rejectionReason}</Alert>}
              <SafeMarkdown source={viewing.body} />
              {viewing.attachmentFileIds.length > 0 && (
                <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Paperclip className="size-4" aria-hidden="true" />{t('reader.attachments', { count: viewing.attachmentFileIds.length })}</p>
              )}
            </Panel>
          ) : (
            <EmptyState title={t('reader.noEffective')} description={canCreate ? t('reader.noEffectiveHintAuthor') : t('reader.noEffectiveHint')} />
          )}

          {canAdoption && (
            <Panel accent="blue" title={t('reader.ackHistory')} description={t('reader.ackHistoryHint')}>
              {acks.isPending ? <Skeleton className="h-16" /> : acks.isError ? (
                <ErrorState compact description={apiErr(acks.error).message} onRetry={() => acks.refetch()} retryLabel={tc('retry')} />
              ) : acks.data.length === 0 ? (
                <p className="text-sm text-muted">{t('reader.noAcks')}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {acks.data.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{a.userName ?? '—'}</span>
                      <span className="text-muted">{t('reader.ackRow', { version: a.versionNumber, when: fmt.dateTime(a.acknowledgedAt) })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <aside className="stagger min-w-0 space-y-6" aria-label={t('reader.sidebar')}>
          {canAck && doc.effectiveVersionId && (
            <Panel accent="green" title={t('reader.ackTitle')} actions={<Hint id="sopAcknowledge" />}>
              {doc.acknowledgedByMe ? (
                <StatusBadge status="success">{t('reader.ackedOn', { when: fmt.dateTime(doc.acknowledgedAt) })}</StatusBadge>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted">{doc.isMandatory ? t('reader.ackRequired') : t('reader.ackOptional')}</p>
                  <Button className="glow-green sheen" loading={ack.isPending} loadingLabel={tc('saving')} leadingIcon={<CheckCircle2 className="size-4" aria-hidden="true" />} onClick={doAck} disabled={!isEffective}>{t('reader.ackButton')}</Button>
                  {!isEffective && <p className="mt-2 text-[0.8125rem] text-muted">{t('reader.ackOnlyEffective')}</p>}
                </>
              )}
            </Panel>
          )}
          <Panel accent="gold" title={t('reader.details')}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">{t('owner')}</dt><dd>{doc.ownerName ?? '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">{t('reader.requirement')}</dt><dd>{doc.isMandatory ? t('mandatory') : t('optional')}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">{t('reader.audience')}</dt><dd className="text-right">{doc.audienceRoles.length ? doc.audienceRoles.join(', ') : t('reader.everyone')}</dd></div>
            </dl>
            {doc.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{doc.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>}
          </Panel>
          <Panel accent="blue" title={t('reader.history')} actions={<History className="size-4 text-muted" aria-hidden="true" />}>
            <ul className="space-y-3">
              {doc.versions.map((v) => (
                <li key={v.id} className="hover-lift rounded-md border border-line p-3 text-sm transition-colors hover:border-gold-400/60">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link className="font-medium underline-offset-2 hover:underline" href={`/sop/${doc.id}?version=${v.id}`}>{t('reader.versionHeading', { version: v.versionNumber })}</Link>
                    <VersionStatusBadge status={v.status} />
                  </div>
                  <p className="mt-1 text-muted">{v.changeSummary ?? '—'}</p>
                  <p className="mt-1 text-[0.8125rem] text-muted">
                    {v.approvedAt ? t('reader.approvedBy', { name: v.approvedByName ?? '—', when: fmt.date(v.approvedAt) }) : t('reader.createdBy', { name: v.createdByName ?? '—', when: fmt.date(v.createdAt) })}
                  </p>
                  {prevOf(v.versionNumber) && (
                    <Link className="mt-1 inline-flex items-center gap-1 text-[0.8125rem] text-blue-700 hover:underline" href={`/sop/${doc.id}/diff?from=${prevOf(v.versionNumber)!.id}&to=${v.id}`}>
                      <FileDiff className="size-3.5" aria-hidden="true" />{t('reader.compare')}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>

      <Dialog open={confirmRetire} onOpenChange={setConfirmRetire}>
        <DialogContent
          title={t('reader.retireTitle')}
          description={t('reader.retireBody')}
          closeLabel={tc('close')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmRetire(false)}>{tc('cancel')}</Button>
              <Button
                variant="danger"
                loading={retire.isPending}
                onClick={async () => {
                  try {
                    await retire.mutateAsync(doc.id);
                    toast({ tone: 'success', title: t('reader.retired') });
                    router.push('/sop');
                  } catch (e) {
                    toast({ tone: 'danger', title: t('reader.retireFailed'), description: apiErr(e).message });
                    setConfirmRetire(false);
                  }
                }}
              >
                {t('reader.retireConfirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">{t('reader.retireAudit')}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
