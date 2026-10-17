'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Copy } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { useAuth } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import {
  useApproveUser, useDismissReset, useIssueReset, usePendingUsers, useRejectUser, useResetDirect, useResetRequests,
  type PendingUser, type ResetRequest,
} from '@/lib/api/hooks/approvals';

/** HR, Founder and Developer: let new accounts in, and hand out one-time password-reset links. */
export function ApprovalsPage() {
  const t = useTranslations('approvals');
  return (
    <RequirePermission permission={['users:approve', 'users:password:reset']}>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Inner />
    </RequirePermission>
  );
}

interface LinkState { name: string; link: string; expiresAt: string; kind: 'invite' | 'reset' }

function Inner() {
  const t = useTranslations('approvals');
  const { can } = useAuth();
  const [shown, setShown] = React.useState<LinkState | null>(null);
  const canApprove = can('users:approve');
  const canReset = can('users:password:reset');
  return (
    <>
      <Tabs defaultValue={canApprove ? 'pending' : 'resets'}>
        <TabsList aria-label={t('title')}>
          {canApprove && <TabsTrigger value="pending">{t('tabPending')}</TabsTrigger>}
          {canReset && <TabsTrigger value="resets">{t('tabResets')}</TabsTrigger>}
          {canReset && <TabsTrigger value="direct">{t('tabDirect')}</TabsTrigger>}
        </TabsList>
        {canApprove && <TabsContent value="pending"><PendingList onLink={setShown} /></TabsContent>}
        {canReset && <TabsContent value="resets"><ResetList onLink={setShown} /></TabsContent>}
        {canReset && <TabsContent value="direct"><DirectReset onLink={setShown} /></TabsContent>}
      </Tabs>
      <LinkDialog state={shown} onClose={() => setShown(null)} />
    </>
  );
}

function ListState({ q, empty, emptyTitle, emptyBody, children }: { q: { isLoading: boolean; isError: boolean; refetch: () => unknown }; empty: boolean; emptyTitle: string; emptyBody: string; children: React.ReactNode }) {
  const t = useTranslations('approvals');
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <Alert tone="danger">{t('loadError')} <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t('retry')}</Button></Alert>;
  if (empty) return <EmptyState title={emptyTitle} description={emptyBody} />;
  return <>{children}</>;
}

function PendingList({ onLink }: { onLink: (l: LinkState) => void }) {
  const t = useTranslations('approvals');
  const q = usePendingUsers();
  const approve = useApproveUser();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const [rejecting, setRejecting] = React.useState<PendingUser | null>(null);
  const onApprove = (u: PendingUser) =>
    approve.mutate(u.id, {
      onSuccess: (r) => { toast({ tone: 'success', title: t('approved') }); onLink({ name: u.name, link: r.invite.link, expiresAt: r.invite.expiresAt, kind: 'invite' }); },
      onError: (e) => toast({ tone: 'danger', title: apiErr(e).message }),
    });
  return (
    <ListState q={q} empty={(q.data?.length ?? 0) === 0} emptyTitle={t('pendingEmpty')} emptyBody={t('pendingEmptyBody')}>
      <ul className="space-y-3" aria-label={t('tabPending')}>
        {(q.data ?? []).map((u) => (
          <li key={u.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">{u.name}</p>
                <p className="break-all text-sm text-muted">{u.email}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted">
                  {t('roles')}: {u.roles.map((r) => <Badge key={r}>{r}</Badge>)}
                  {u.createdByName ? <span> · {t('createdBy', { name: u.createdByName })}</span> : null}
                </p>
              </div>
              <div className="flex gap-2">
                <Button className="min-h-11" disabled={!u.canApprove} loading={approve.isPending && approve.variables === u.id} onClick={() => onApprove(u)}>{t('approve')}</Button>
                <Button className="min-h-11" variant="secondary" onClick={() => setRejecting(u)}>{t('reject')}</Button>
              </div>
            </div>
            {!u.canApprove && <p className="mt-2 text-xs text-muted">{u.createdById ? t('ownAccount') : t('leadership')}</p>}
          </li>
        ))}
      </ul>
      {rejecting && <RejectDialog user={rejecting} onClose={() => setRejecting(null)} />}
    </ListState>
  );
}

function RejectDialog({ user, onClose }: { user: PendingUser; onClose: () => void }) {
  const t = useTranslations('approvals');
  const reject = useRejectUser();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const [reason, setReason] = React.useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t('rejectTitle')} description={t('rejectBody', { name: user.name })} closeLabel={t('close')}
        footer={<><Button variant="secondary" onClick={onClose}>{t('close')}</Button>
          <Button loading={reject.isPending} onClick={() => reject.mutate({ id: user.id, reason: reason.trim() || undefined }, { onSuccess: () => { toast({ tone: 'success', title: t('rejected') }); onClose(); } })}>{t('reject')}</Button></>}
      >
        {reject.isError && <Alert tone="danger" className="mb-3">{apiErr(reject.error).message}</Alert>}
        <FormField label={t('rejectReason')}><Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </DialogContent>
    </Dialog>
  );
}

function ResetList({ onLink }: { onLink: (l: LinkState) => void }) {
  const t = useTranslations('approvals');
  const locale = useLocale();
  const q = useResetRequests();
  const issue = useIssueReset();
  const dismiss = useDismissReset();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const when = (iso: string) => new Intl.DateTimeFormat(locale === 'en' ? 'en-IN' : locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
  const onIssue = (r: ResetRequest) =>
    issue.mutate(r.id, {
      onSuccess: (x) => onLink({ name: r.name, link: x.link, expiresAt: x.expiresAt, kind: 'reset' }),
      onError: (e) => toast({ tone: 'danger', title: apiErr(e).message }),
    });
  return (
    <ListState q={q} empty={(q.data?.length ?? 0) === 0} emptyTitle={t('resetsEmpty')} emptyBody={t('resetsEmptyBody')}>
      <ul className="space-y-3" aria-label={t('tabResets')}>
        {(q.data ?? []).map((r) => (
          <li key={r.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">{r.name}</p>
                <p className="break-all text-sm text-muted">{r.email}</p>
                <p className="mt-1 text-xs text-muted">{t('requestedAt', { when: when(r.requestedAt) })}</p>
              </div>
              <div className="flex gap-2">
                <Button className="min-h-11" disabled={!r.canIssue} loading={issue.isPending && issue.variables === r.id} onClick={() => onIssue(r)}>{t('issue')}</Button>
                <Button className="min-h-11" variant="secondary" loading={dismiss.isPending && dismiss.variables === r.id} onClick={() => dismiss.mutate(r.id, { onSuccess: () => toast({ tone: 'success', title: t('dismissed') }) })}>{t('dismiss')}</Button>
              </div>
            </div>
            {!r.canIssue && <p className="mt-2 text-xs text-muted">{t('cannotIssue')}</p>}
          </li>
        ))}
      </ul>
    </ListState>
  );
}

function DirectReset({ onLink }: { onLink: (l: LinkState) => void }) {
  const t = useTranslations('approvals');
  const direct = useResetDirect();
  const apiErr = useApiErrorMessage();
  const [email, setEmail] = React.useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    direct.mutate(email.trim(), { onSuccess: (x) => { onLink({ name: x.name, link: x.link, expiresAt: x.expiresAt, kind: 'reset' }); setEmail(''); } });
  };
  return (
    <form onSubmit={submit} className="max-w-md space-y-3" noValidate aria-label={t('directTitle')}>
      <h2 className="font-display text-lg font-semibold text-ink">{t('directTitle')}</h2>
      <p className="text-sm text-muted">{t('directBody')}</p>
      {direct.isError && <Alert tone="danger">{apiErr(direct.error).message}</Alert>}
      <FormField label={t('email')} required><Input type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
      <Button type="submit" className="min-h-11" disabled={!email.includes('@')} loading={direct.isPending}>{t('directGo')}</Button>
    </form>
  );
}

/** The one-time link, shown once to whoever issued it, with a copy button. */
export function LinkDialog({ state, onClose }: { state: LinkState | null; onClose: () => void }) {
  const t = useTranslations('approvals');
  const locale = useLocale();
  const { toast } = useToast();
  if (!state) return null;
  const expires = new Intl.DateTimeFormat(locale === 'en' ? 'en-IN' : locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(state.expiresAt));
  const copy = async () => {
    try { await navigator.clipboard.writeText(state.link); toast({ tone: 'success', title: t('copied') }); } catch { toast({ tone: 'danger', title: t('copyFailed') }); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t('linkTitle', { name: state.name })} description={state.kind === 'invite' ? t('linkBodyInvite') : t('linkBodyReset')} closeLabel={t('close')}
        footer={<><Button leadingIcon={<Copy className="size-4" aria-hidden="true" />} onClick={() => void copy()}>{t('copy')}</Button><Button variant="secondary" onClick={onClose}>{t('close')}</Button></>}
      >
        <Alert tone="warning" className="mb-3">{t('linkWarning')}</Alert>
        <FormField label={t('linkLabel')} hint={t('linkExpires', { when: expires })}>
          <Input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} />
        </FormField>
      </DialogContent>
    </Dialog>
  );
}
