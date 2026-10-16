'use client';
import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Copy, KeyRound, LockOpen, LogOut } from 'lucide-react';
import {
  Alert, Badge, Button, Dialog, DialogContent, EmptyState, ErrorState, FormField, Input, LoadingRegion, Panel, Select, Skeleton, Tabs, TabsList, TabsTrigger, useToast,
} from '@salesos/ui';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useDevUsers } from '@/lib/api/hooks/devpanel';
import {
  useDevAudit, useIssueResetLink, useLockedAccounts, useLoginHistory, useRevokeSecuritySession, useSecuritySessions, useUnlockAccount,
  type ResetLink,
} from '@/lib/api/hooks/devpanel-security';

type Sub = 'sessions' | 'history' | 'locked' | 'reset' | 'audit';
const LOGIN_ACTIONS = ['auth.login_success', 'auth.login_failed', 'auth.account_locked', 'auth.logout', 'auth.password_reset_requested', 'auth.password_reset_completed', 'auth.invite_accepted', 'auth.sessions_revoked'] as const;
const AUDIT_ACTIONS = ['devpanel.session_revoked', 'devpanel.account_unlocked', 'devpanel.reset_link_issued', 'devpanel.roles_changed', 'devpanel.sessions_revoked', 'devpanel.force_logout_all'] as const;

/** Developer Panel / security tab. */
export function SecurityTab() {
  const t = useTranslations('developer.security');
  const [sub, setSub] = React.useState<Sub>('sessions');
  const reduce = useReducedMotion();
  return (
    <div className="space-y-4">
      <Tabs value={sub} onValueChange={(v) => setSub(v as Sub)}>
        <TabsList aria-label={t('title')}>
          {(['sessions', 'history', 'locked', 'reset', 'audit'] as const).map((s) => (
            <TabsTrigger key={s} value={s}>{t(`sub.${s}`)}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <motion.div key={sub} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}>
        {sub === 'sessions' && <SessionsSection />}
        {sub === 'history' && <HistorySection />}
        {sub === 'locked' && <LockedSection />}
        {sub === 'reset' && <ResetSection />}
        {sub === 'audit' && <AuditSection />}
      </motion.div>
    </div>
  );
}

/* ------------------------------ shared bits ------------------------------ */

function useWhen() {
  const f = useFormatter();
  return (iso: string | null | undefined) => (iso ? f.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
}

/** Staggered list item that slides out smoothly when removed (kill / unlock). Reduced motion: instant. */
function Row({ children, index }: { children: React.ReactNode; index: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      layout={reduce ? false : 'position'}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: reduce ? 0 : 0.22, delay: reduce ? 0 : Math.min(index, 8) * 0.04 } }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24, height: 0, transition: { duration: 0.2 } }}
      className="flex flex-wrap items-center justify-between gap-3 overflow-hidden py-3"
    >
      {children}
    </motion.li>
  );
}

function ListStates({ q, empty, children }: { q: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; empty: boolean; children: React.ReactNode }) {
  const tc = useTranslations('common');
  const t = useTranslations('developer.security');
  const apiErr = useApiErrorMessage();
  if (q.isPending) {
    return (
      <LoadingRegion label={tc('loading')} className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </LoadingRegion>
    );
  }
  if (q.isError) return <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />;
  if (empty) return <EmptyState title={t('empty')} />;
  return <>{children}</>;
}

function LoadMore({ q }: { q: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  const t = useTranslations('developer.security');
  if (!q.hasNextPage) return null;
  return (
    <div className="pt-3">
      <Button variant="secondary" size="sm" loading={q.isFetchingNextPage} loadingLabel={t('loading')} onClick={() => void q.fetchNextPage()}>{t('loadMore')}</Button>
    </div>
  );
}

function UserSelect({ value, onChange, label, activeOnly }: { value: string; onChange: (v: string) => void; label: string; activeOnly?: boolean }) {
  const t = useTranslations('developer.security');
  const users = useDevUsers(activeOnly ? { isActive: 'true' } : {});
  return (
    <FormField label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('anyUser')}</option>
        {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
      </Select>
    </FormField>
  );
}

function Confirm({ open, title, description, confirmLabel, pending, error, onConfirm, onClose }: {
  open: boolean; title: string; description: string; confirmLabel: string; pending: boolean; error: string | null; onConfirm: () => void; onClose: () => void;
}) {
  const tc = useTranslations('common');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="sm"
        title={title}
        description={description}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>{tc('cancel')}</Button>
            <Button variant="danger" onClick={onConfirm} loading={pending} loadingLabel={tc('saving')}>{confirmLabel}</Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : <span className="sr-only">{description}</span>}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Live sessions ------------------------------ */

function SessionsSection() {
  const t = useTranslations('developer.security.sessions');
  const ts = useTranslations('developer.security');
  const when = useWhen();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const reduce = useReducedMotion();
  const [userId, setUserId] = React.useState('');
  const q = useSecuritySessions(userId);
  const kill = useRevokeSecuritySession();
  const [target, setTarget] = React.useState<{ id: string; userName: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  async function confirm() {
    if (!target) return;
    setError(null);
    try {
      await kill.mutateAsync(target.id);
      toast({ tone: 'success', title: t('killed', { name: target.userName }) });
      setTarget(null);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }

  return (
    <Panel title={<span className="inline-flex items-center gap-2">{t('title')}<LiveDot active={!reduce && items.length > 0} /></span>} description={t('description')}>
      <div className="mb-4 max-w-md"><UserSelect value={userId} onChange={setUserId} label={ts('filterUser')} /></div>
      <ListStates q={q} empty={items.length === 0}>
        <ul className="divide-y divide-line" aria-label={t('title')}>
          <AnimatePresence initial={false}>
            {items.map((s, i) => (
              <Row key={s.id} index={i}>
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{s.userName}</p>
                  <p className="truncate text-sm text-muted">{s.userEmail}</p>
                  <p className="mt-1 text-xs text-muted">{t('seen', { time: when(s.lastSeenAt) })} · {t('expires', { time: when(s.expiresAt) })}</p>
                  <p className="truncate text-xs text-muted">{s.ip ?? t('noIp')} · {s.userAgent ?? t('noAgent')}</p>
                  {s.isCurrent && <Badge tone="gold" className="mt-1.5">{t('current')}</Badge>}
                </div>
                <Button size="sm" variant="danger" disabled={s.isCurrent} onClick={() => { setError(null); setTarget({ id: s.id, userName: s.userName }); }} leadingIcon={<LogOut aria-hidden />}>
                  {t('kill')}<span className="sr-only"> {s.userName}</span>
                </Button>
              </Row>
            ))}
          </AnimatePresence>
        </ul>
        <LoadMore q={q} />
      </ListStates>
      <Confirm open={!!target} title={t('confirmTitle')} description={t('confirmBody', { name: target?.userName ?? '' })} confirmLabel={t('kill')} pending={kill.isPending} error={error} onConfirm={() => void confirm()} onClose={() => setTarget(null)} />
    </Panel>
  );
}

/** Small pulsing dot for live status. The text next to it carries the meaning; the dot is decorative. */
function LiveDot({ active }: { active: boolean }) {
  return (
    <span aria-hidden className="relative inline-flex size-2">
      {active && <motion.span className="absolute inline-flex size-full rounded-full bg-green-600/60" animate={{ scale: [1, 2.2], opacity: [0.6, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }} />}
      <span className="relative inline-flex size-2 rounded-full bg-green-600" />
    </span>
  );
}

/* ------------------------------ Login history ------------------------------ */

function DateRange({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const t = useTranslations('developer.security');
  return (
    <>
      <FormField label={t('from')}><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></FormField>
      <FormField label={t('to')}><Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></FormField>
    </>
  );
}

function HistorySection() {
  const t = useTranslations('developer.security.history');
  const ts = useTranslations('developer.security');
  const when = useWhen();
  const [action, setAction] = React.useState('');
  const [userId, setUserId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const q = useLoginHistory({ action, userId, from, to });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const note = q.data?.pages[0]?.note;
  const tone = (a: string) => (a === 'auth.login_success' || a === 'auth.password_reset_completed' || a === 'auth.invite_accepted' ? 'green' : a === 'auth.login_failed' || a === 'auth.account_locked' ? 'red' : 'neutral');
  return (
    <Panel title={t('title')} description={t('description')}>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t('action')}>
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{t('anyAction')}</option>
            {LOGIN_ACTIONS.map((a) => <option key={a} value={a}>{t(`actions.${a.replace('auth.', '')}`)}</option>)}
          </Select>
        </FormField>
        <UserSelect value={userId} onChange={setUserId} label={ts('filterUser')} />
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      <Alert tone="info" className="mb-4">{t('limitation')}{note ? ` ${note}` : ''}</Alert>
      <ListStates q={q} empty={items.length === 0}>
        <ul className="divide-y divide-line" aria-label={t('title')}>
          {items.map((e, i) => (
            <Row key={e.id} index={i}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={tone(e.action)}>{t(`actions.${e.action.replace('auth.', '')}`)}</Badge>
                  {e.reason && <span className="text-xs text-muted">{t('reason', { reason: e.reason })}</span>}
                </div>
                <p className="mt-1 truncate text-sm text-ink">{e.userName ?? '—'} <span className="text-muted">{e.userEmail ?? ''}</span></p>
                <p className="text-xs text-muted">{when(e.createdAt)} · {e.ip ?? t('noIp')}</p>
              </div>
            </Row>
          ))}
        </ul>
        <LoadMore q={q} />
      </ListStates>
    </Panel>
  );
}

/* ------------------------------ Locked accounts ------------------------------ */

function LockedSection() {
  const t = useTranslations('developer.security.locked');
  const when = useWhen();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const q = useLockedAccounts();
  const unlock = useUnlockAccount();
  const [target, setTarget] = React.useState<{ id: string; name: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const items = q.data ?? [];

  async function confirm() {
    if (!target) return;
    setError(null);
    try {
      await unlock.mutateAsync(target.id);
      toast({ tone: 'success', title: t('done', { name: target.name }) });
      setTarget(null);
    } catch (e) {
      setError(apiErr(e).message);
    }
  }

  return (
    <Panel title={t('title')} description={t('description')}>
      <ListStates q={q} empty={items.length === 0}>
        <ul className="divide-y divide-line" aria-label={t('title')}>
          <AnimatePresence initial={false}>
            {items.map((u, i) => (
              <Row key={u.id} index={i}>
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{u.name}</p>
                  <p className="truncate text-sm text-muted">{u.email}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {u.isLocked ? <Badge tone="red">{t('lockedUntil', { time: when(u.lockedUntil) })}</Badge> : <Badge tone="gold">{t('watch')}</Badge>}
                    <Badge tone="neutral">{t('failures', { count: u.failedLoginCount })}</Badge>
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => { setError(null); setTarget({ id: u.id, name: u.name }); }} leadingIcon={<LockOpen aria-hidden />}>
                  {t('unlock')}<span className="sr-only"> {u.name}</span>
                </Button>
              </Row>
            ))}
          </AnimatePresence>
        </ul>
      </ListStates>
      <Confirm open={!!target} title={t('confirmTitle')} description={t('confirmBody', { name: target?.name ?? '' })} confirmLabel={t('unlock')} pending={unlock.isPending} error={error} onConfirm={() => void confirm()} onClose={() => setTarget(null)} />
    </Panel>
  );
}

/* ------------------------------ Password-reset link ------------------------------ */

function ResetSection() {
  const t = useTranslations('developer.security.reset');
  const ts = useTranslations('developer.security');
  const [userId, setUserId] = React.useState('');
  const [open, setOpen] = React.useState(false);
  return (
    <Panel title={t('title')} description={t('description')}>
      <div className="max-w-md space-y-3">
        <UserSelect value={userId} onChange={setUserId} label={t('user')} activeOnly />
        <Button disabled={!userId} onClick={() => setOpen(true)} leadingIcon={<KeyRound aria-hidden />}>{t('issue')}</Button>
      </div>
      <Alert tone="info" className="mt-4">{ts('reset.once')}</Alert>
      {open && <ResetDialog userId={userId} onClose={() => setOpen(false)} />}
    </Panel>
  );
}

function ResetDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const t = useTranslations('developer.security.reset');
  const tc = useTranslations('common');
  const when = useWhen();
  const apiErr = useApiErrorMessage();
  const issue = useIssueResetLink();
  // The link only ever lives in this component's state; closing the dialog discards it for good.
  const [result, setResult] = React.useState<ResetLink | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function run() {
    setError(null);
    try {
      setResult(await issue.mutateAsync(userId));
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
    } catch {
      setError(t('copyFailed'));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="md"
        title={t('dialogTitle')}
        description={result ? t('shownOnce') : t('confirmBody')}
        closeLabel={tc('close')}
        footer={
          result ? (
            <Button onClick={onClose}>{tc('close')}</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>{tc('cancel')}</Button>
              <Button onClick={() => void run()} loading={issue.isPending} loadingLabel={tc('saving')}>{t('issue')}</Button>
            </>
          )
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          {result && (
            <>
              <Alert tone="warning">{t('warn', { time: when(result.expiresAt) })}</Alert>
              <FormField label={t('linkLabel')}>
                <Input readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} />
              </FormField>
              <Button variant="secondary" size="sm" onClick={() => void copy()} leadingIcon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}>
                {copied ? t('copied') : t('copy')}
              </Button>
              <p role="status" className="sr-only">{copied ? t('copied') : ''}</p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Developer audit trail ------------------------------ */

function AuditSection() {
  const t = useTranslations('developer.security.audit');
  const ts = useTranslations('developer.security');
  const when = useWhen();
  const [action, setAction] = React.useState('');
  const [actorId, setActorId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const q = useDevAudit({ action, actorId, from, to });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Panel title={t('title')} description={t('description')}>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t('action')}>
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{t('anyAction')}</option>
            {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        </FormField>
        <UserSelect value={actorId} onChange={setActorId} label={t('actor')} />
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </div>
      <ListStates q={q} empty={items.length === 0}>
        <ul className="divide-y divide-line" aria-label={t('title')}>
          {items.map((r, i) => (
            <Row key={r.id} index={i}>
              <div className="min-w-0">
                <Badge tone="blue">{r.action}</Badge>
                <p className="mt-1 truncate text-sm text-ink">{r.actorName ?? ts('unknownActor')}</p>
                <p className="text-xs text-muted">{when(r.createdAt)} · {r.entityType}{r.entityId ? ` ${r.entityId.slice(0, 8)}` : ''} · {r.ip ?? '—'}</p>
              </div>
            </Row>
          ))}
        </ul>
        <LoadMore q={q} />
      </ListStates>
    </Panel>
  );
}
