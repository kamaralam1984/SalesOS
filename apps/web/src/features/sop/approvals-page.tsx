'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check, Eye, FileDiff, X } from 'lucide-react';
import { Alert, Button, DataTable, Dialog, DialogContent, FormField, Input, PageHeader, Textarea, useToast, type Column } from '@salesos/ui';
import { Reveal } from '@/components/motion';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useApproveVersion, useRejectVersion, useSopList, type SopListItem } from './api';
import { useFmt } from './shared';

export function ApprovalsPage() {
  return (
    <RequirePermission permission="sop:approve">
      <ApprovalsInner />
    </RequirePermission>
  );
}

type Target = { doc: SopListItem; versionId: string };

function ApprovalsInner() {
  const t = useTranslations('sop.approvals');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const fmt = useFmt();
  const tcat = useTranslations('sop.categories');
  const q = useSopList({ limit: 100, includeRetired: false });
  const pending = (q.data?.items ?? []).filter((d) => d.openVersion?.status === 'PENDING_APPROVAL');
  const [approve, setApprove] = React.useState<Target | null>(null);
  const [reject, setReject] = React.useState<Target | null>(null);

  const cols: Column<SopListItem>[] = [
    { id: 'doc', header: t('document'), primary: true, cell: (d) => <Link className="font-medium hover:underline" href={`/sop/${d.id}`}>{d.title}</Link> },
    { id: 'cat', header: t('category'), hideOnMobile: true, cell: (d) => tcat(d.category as never) },
    { id: 'ver', header: t('version'), cell: (d) => `v${d.openVersion!.versionNumber}` },
    { id: 'cur', header: t('current'), hideOnMobile: true, cell: (d) => (d.effectiveVersion ? t('currentLine', { version: d.effectiveVersion.versionNumber, date: fmt.date(d.effectiveVersion.effectiveDate) }) : t('none')) },
  ];
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} breadcrumbs={[{ label: t('library'), href: '/sop' }, { label: t('title') }]} breadcrumbLabel={tc('breadcrumb')} />
      <Reveal delay={0.08}>
      <DataTable
        caption={t('title')}
        columns={cols}
        rows={q.isPending ? undefined : pending}
        loading={q.isPending}
        error={q.isError ? { message: apiErr(q.error).message, onRetry: () => q.refetch() } : null}
        getRowId={(d) => d.id}
        emptyTitle={t('empty')}
        emptyDescription={t('emptyHint')}
        loadingLabel={tc('loading')}
        actionsHeader={tc('actions')}
        rowActions={(d) => (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="ghost"><Link href={`/sop/${d.id}?version=${d.openVersion!.id}`}><Eye className="size-4" aria-hidden="true" />{t('review')}</Link></Button>
            {d.effectiveVersion && <Button asChild size="sm" variant="ghost"><Link href={`/sop/${d.id}/diff?from=${d.effectiveVersion.id}&to=${d.openVersion!.id}`}><FileDiff className="size-4" aria-hidden="true" />{t('compare')}</Link></Button>}
            <Button size="sm" leadingIcon={<Check className="size-4" aria-hidden="true" />} onClick={() => setApprove({ doc: d, versionId: d.openVersion!.id })}>{t('approve')}</Button>
            <Button size="sm" variant="danger" leadingIcon={<X className="size-4" aria-hidden="true" />} onClick={() => setReject({ doc: d, versionId: d.openVersion!.id })}>{t('reject')}</Button>
          </div>
        )}
      />
      </Reveal>
      <Dialog open={Boolean(approve)} onOpenChange={(o) => !o && setApprove(null)}>{approve && <ApproveBody target={approve} onDone={() => setApprove(null)} />}</Dialog>
      <Dialog open={Boolean(reject)} onOpenChange={(o) => !o && setReject(null)}>{reject && <RejectBody target={reject} onDone={() => setReject(null)} />}</Dialog>
    </>
  );
}

function ApproveBody({ target, onDone }: { target: Target; onDone: () => void }) {
  const t = useTranslations('sop.approvals');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const m = useApproveVersion();
  const [date, setDate] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <DialogContent
      title={t('approveTitle', { name: target.doc.title })}
      description={t('approveBody')}
      closeLabel={tc('close')}
      footer={<><Button variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button loading={m.isPending} loadingLabel={tc('saving')} onClick={async () => {
          setErr(null);
          try {
            const r = await m.mutateAsync({ id: target.versionId, effectiveDate: date || undefined });
            toast({ tone: 'success', title: t('approved'), description: t('remindersQueued', { count: r.remindersQueued }) });
            onDone();
          } catch (e) { setErr(apiErr(e).message); }
        }}>{t('approveConfirm')}</Button></>}
    >
      <div className="space-y-4">
        {err && <Alert tone="danger" live>{err}</Alert>}
        <FormField label={t('effectiveDate')} hint={t('effectiveDateHint')}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></FormField>
        <p className="text-sm text-muted">{t('immutableNotice')}</p>
      </div>
    </DialogContent>
  );
}

function RejectBody({ target, onDone }: { target: Target; onDone: () => void }) {
  const t = useTranslations('sop.approvals');
  const tv = useTranslations('validation');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const m = useRejectVersion();
  const [reason, setReason] = React.useState('');
  const [fieldErr, setFieldErr] = React.useState<string | undefined>();
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <DialogContent
      title={t('rejectTitle', { name: target.doc.title })}
      description={t('rejectBody')}
      closeLabel={tc('close')}
      footer={<><Button variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button variant="danger" loading={m.isPending} loadingLabel={tc('saving')} onClick={async () => {
          if (reason.trim().length < 3) { setFieldErr(tv('required')); return; }
          setErr(null);
          try {
            await m.mutateAsync({ id: target.versionId, reason: reason.trim() });
            toast({ tone: 'success', title: t('rejected') });
            onDone();
          } catch (e) { setErr(apiErr(e).message); }
        }}>{t('rejectConfirm')}</Button></>}
    >
      <div className="space-y-4">
        {err && <Alert tone="danger" live>{err}</Alert>}
        <FormField label={t('reason')} error={fieldErr} required><Textarea rows={4} value={reason} onChange={(e) => { setReason(e.target.value); setFieldErr(undefined); }} /></FormField>
      </div>
    </DialogContent>
  );
}
