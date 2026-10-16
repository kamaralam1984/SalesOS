'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { Activity, KeyRound, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  LoadingRegion,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
} from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { useAuth } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import {
  useDevUsers,
  useForceLogoutAll,
  useRevokeSessions,
  useServerStatus,
  useSetDevRoles,
  type DevUser,
} from '@/lib/api/hooks/devpanel';
import { OverviewTab } from './tabs/overview-tab';
import { DiagnosticsTab } from './tabs/diagnostics-tab';
import { SecurityTab } from './tabs/security-tab';
import { AccessTab } from './tabs/access-tab';
import { MaintenanceTab } from './tabs/maintenance-tab';
import { RolesTab } from './tabs/roles-tab';
import { PRIMARY_ROLE_KEYS, ROLE_KEYS, SECONDARY_ROLE_KEYS, type RoleKey } from '@/lib/api/types';

export function DeveloperPanel() {
  return (
    <RequirePermission permission="devpanel:access">
      <Inner />
    </RequirePermission>
  );
}

/** Fade/slide-in used for tab content and staggered panels. Reduced motion: no transform, no delay. */
function Rise({ children, index = 0, className }: { children: React.ReactNode; index?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.28, delay: reduce ? 0 : Math.min(index, 6) * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      {className ? <div className={className}>{children}</div> : children}
    </motion.div>
  );
}

type Tab = 'overview' | 'users' | 'guide' | 'diagnostics' | 'security' | 'access' | 'server' | 'sessions' | 'maintenance';

function Inner() {
  const t = useTranslations('developer');
  const { can } = useAuth();
  const [tab, setTab] = React.useState<Tab>('overview');
  const reduceTabs = useReducedMotion();
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} actions={<Link href="/dashboard?workspace=1" className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline">{t('workspaceLink')}</Link>} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-6">
        <TabsList>
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="users">{t('tabs.users')}</TabsTrigger>
          <TabsTrigger value="guide">{t('tabs.guide')}</TabsTrigger>
          {can('devpanel:diagnostics:view') && <TabsTrigger value="diagnostics">{t('tabs.diagnostics')}</TabsTrigger>}
          {can('devpanel:security:view') && <TabsTrigger value="security">{t('tabs.security')}</TabsTrigger>}
          {can('devpanel:config:view') && <TabsTrigger value="access">{t('tabs.access')}</TabsTrigger>}
          {can('devpanel:server:view') && <TabsTrigger value="server">{t('tabs.server')}</TabsTrigger>}
          {can('devpanel:sessions:revoke') && <TabsTrigger value="sessions">{t('tabs.sessions')}</TabsTrigger>}
          {can('devpanel:maintenance:manage') && <TabsTrigger value="maintenance">{t('tabs.maintenance')}</TabsTrigger>}
        </TabsList>
      </Tabs>
      <motion.div key={tab} className="mt-4" initial={reduceTabs ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceTabs ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'guide' && <RolesTab />}
        {tab === 'diagnostics' && <DiagnosticsTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'access' && <AccessTab />}
        {tab === 'maintenance' && <MaintenanceTab />}
        {tab === 'server' && <ServerTab />}
        {tab === 'sessions' && <SessionsTab />}
      </motion.div>
    </>
  );
}

/* ------------------------------ Users and roles ------------------------------ */

function UsersTab() {
  const t = useTranslations('developer.users');
  const tr = useTranslations('roles');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const me = useAuth().user;
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [role, setRole] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [editing, setEditing] = React.useState<DevUser | null>(null);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const q = useDevUsers({
    ...(debounced ? { search: debounced } : {}),
    ...(role ? { role } : {}),
    ...(status ? { isActive: status } : {}),
  });
  const revoke = useRevokeSessions();
  const th = useTranslations('developer');

  return (
    <Rise>
    <Panel>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <FormField label={t('search')}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
        </FormField>
        <FormField label={t('roles')}>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{t('allRoles')}</option>
            {ROLE_KEYS.map((r) => (
              <option key={r} value={r}>{tr(r)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('status')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">—</option>
            <option value="true">{t('active')}</option>
            <option value="false">{t('inactive')}</option>
          </Select>
        </FormField>
      </div>
      {q.isPending && (
        <LoadingRegion label={tc('loading')} className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </LoadingRegion>
      )}
      {q.isError && <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />}
      {q.data && q.data.length === 0 && <EmptyState title={t('empty')} />}
      {q.data && q.data.length > 0 && (
        <ul className="divide-y divide-line">
          {q.data.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{u.name}</p>
                <p className="truncate text-sm text-muted">{u.email}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {u.roles.map((r) => (
                    <Badge key={r} tone={r === 'DEVELOPER' ? 'gold' : 'neutral'}>{tr(r)}</Badge>
                  ))}
                  {!u.isActive && <Badge tone="red">{t('inactive')}</Badge>}
                  <Badge tone="blue">{t('sessions', { count: u.activeSessions })}</Badge>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={u.id === me?.id} onClick={() => setEditing(u)} leadingIcon={<KeyRound aria-hidden />}>
                  {t('manageRoles')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={u.activeSessions === 0}
                  loading={revoke.isPending && revoke.variables === u.id}
                  onClick={() =>
                    revoke.mutate(u.id, {
                      onSuccess: (r) => toast({ tone: 'success', title: th('revoke.done', { count: r.revoked }) }),
                      onError: (e) => toast({ tone: 'danger', title: apiErr(e).message }),
                    })
                  }
                >
                  {t('revokeSessions')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <RolesDialog user={editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </Panel>
    </Rise>
  );
}

/** Roles for one user as toggles. Every toggle saves at once (one request with the full new role set); the server stays the authority. */
export function RolesDialog({ user, onClose }: { user: DevUser; onClose: () => void }) {
  const t = useTranslations('developer.roles');
  const tr = useTranslations('roles');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const save = useSetDevRoles();
  const [roles, setRoles] = React.useState<RoleKey[]>(user.roles);
  const [busy, setBusy] = React.useState<RoleKey | null>(null);
  const [confirm, setConfirm] = React.useState<RoleKey | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const isPrimary = (r: RoleKey) => (PRIMARY_ROLE_KEYS as readonly string[]).includes(r);
  // Granting these changes who controls the platform, so they need a second, explicit click.
  const GUARDED: RoleKey[] = ['DEVELOPER', 'FOUNDER_CEO'];

  function apply(role: RoleKey, on: boolean) {
    setError(null);
    setConfirm(null);
    // one primary role at a time: switching a primary on replaces the current one in the same request
    const next = on
      ? [...roles.filter((r) => !(isPrimary(role) && isPrimary(r))), role]
      : roles.filter((r) => r !== role);
    setBusy(role);
    save.mutate(
      { id: user.id, roles: next },
      {
        onSuccess: (res) => {
          setRoles(res.roles);
          toast({ tone: 'success', title: t('toggled', { name: user.name, role: tr(role), state: on ? t('on') : t('off') }) });
        },
        onError: (e) => setError(apiErr(e).message),
        onSettled: () => setBusy(null),
      },
    );
  }

  function onToggle(role: RoleKey, on: boolean) {
    if (on && GUARDED.includes(role)) setConfirm(role);
    else apply(role, on);
  }

  const row = (r: RoleKey) => (
    <Switch
      key={r}
      label={tr(r)}
      checked={roles.includes(r)}
      disabled={busy !== null}
      onCheckedChange={(c) => onToggle(r, c)}
    />
  );

  return (
    <DialogContent size="md" title={t('title', { name: user.name })} description={t('toggleDescription')} closeLabel={tc('close')} footer={<Button variant="secondary" onClick={onClose}>{t('done')}</Button>}>
      <div className="space-y-4" aria-busy={busy !== null}>
        {error && <Alert tone="danger">{error}</Alert>}
        {confirm && (
          <Alert tone="warning">
            <p>{confirm === 'DEVELOPER' ? t('warnDeveloper') : t('warnFounder')}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => apply(confirm, true)}>{t('confirmGrant', { role: tr(confirm) })}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>{tc('cancel')}</Button>
            </div>
          </Alert>
        )}
        <fieldset>
          <legend className="text-sm font-medium text-ink">{t('primary')}</legend>
          <p className="mb-2 text-xs text-muted">{t('primaryHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">{PRIMARY_ROLE_KEYS.map(row)}</div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">{t('secondary')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">{SECONDARY_ROLE_KEYS.map(row)}</div>
        </fieldset>
        <p className="text-xs text-muted">{t('signOutNote')}</p>
      </div>
    </DialogContent>
  );
}

/* ------------------------------ Server ------------------------------ */

const fmtBytes = (n: number) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};
const fmtDur = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

function ServerTab() {
  const t = useTranslations('developer.server');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const q = useServerStatus(true);
  const s = q.data;
  const tone = (v: string) => (v === 'ok' ? 'green' : v === 'down' ? 'red' : 'gold');
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {s ? t('checked', { time: new Date(s.checkedAt).toLocaleTimeString(), ms: s.probeMs }) : ''}
        </p>
        <Button size="sm" variant="secondary" loading={q.isFetching} onClick={() => void q.refetch()} leadingIcon={<RefreshCw aria-hidden />}>
          {t('refresh')}
        </Button>
      </div>
      {q.isPending && (
        <LoadingRegion label={tc('loading')}>
          <Skeleton className="h-40 w-full" />
        </LoadingRegion>
      )}
      {q.isError && <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />}
      {s && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Rise index={0}><Panel title={<span className="inline-flex items-center gap-2"><Activity aria-hidden className="size-4" />{t('database')} / Redis / {t('worker')}</span>}>
            <dl className="divide-y divide-line">
              {row(t('database'), <Badge tone={tone(s.services.database)}>{t(s.services.database)}</Badge>)}
              {row(t('redis'), <Badge tone={tone(s.services.redis)}>{t(s.services.redis)}</Badge>)}
              {row(t('worker'), <Badge tone={tone(s.services.worker)}>{t(s.services.worker)}</Badge>)}
              {s.outbox && row(t('outbox'), `${t('pending')}: ${s.outbox.pending} · ${t('dead')}: ${s.outbox.dead}`)}
              {s.outbox && s.outbox.pending > 0 && row('', t('oldest', { seconds: Math.round(s.outbox.oldestPendingSeconds) }))}
            </dl>
          </Panel></Rise>
          <Rise index={1}><Panel title={t('process')}>
            <dl className="divide-y divide-line">
              {row(t('node'), s.process.nodeVersion)}
              {row(t('uptime'), fmtDur(s.process.uptimeSeconds))}
              {row(t('memory'), fmtBytes(s.process.rssBytes))}
            </dl>
          </Panel></Rise>
          <Rise index={2} className="lg:col-span-2"><Panel title={t('host')}>
            <dl className="divide-y divide-line">
              {row(t('cpus'), s.host.cpuCount)}
              {row(t('load'), s.host.loadAvg.map((n) => n.toFixed(2)).join(' / '))}
              {row(t('ram'), `${fmtBytes(s.host.freeMemBytes)} / ${fmtBytes(s.host.totalMemBytes)}`)}
              {s.host.disk && row(t('disk'), `${fmtBytes(s.host.disk.freeBytes)} / ${fmtBytes(s.host.disk.totalBytes)}`)}
              {row(t('uptime'), fmtDur(s.host.hostUptimeSeconds))}
            </dl>
          </Panel></Rise>
        </div>
      )}
      <Alert tone="info">{t('readOnly')}</Alert>
    </div>
  );
}

/* ------------------------------ Sessions ------------------------------ */

function SessionsTab() {
  const t = useTranslations('developer.forceLogout');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const m = useForceLogoutAll();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  async function confirm() {
    setError(null);
    try {
      const r = await m.mutateAsync(reason.trim());
      toast({ tone: 'success', title: t('done', { count: r.revoked }) });
      setOpen(false);
      setReason('');
    } catch (e) {
      setError(apiErr(e).message);
    }
  }

  return (
    <Rise>
    <Panel title={t('title')} description={t('description')}>
      <Button variant="danger" onClick={() => setOpen(true)} leadingIcon={<ShieldAlert aria-hidden />}>{t('confirm')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          size="sm"
          title={t('title')}
          description={t('description')}
          closeLabel={tc('close')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>{tc('cancel')}</Button>
              <Button variant="danger" disabled={reason.trim().length < 3} onClick={() => void confirm()} loading={m.isPending} loadingLabel={tc('saving')} leadingIcon={<LogOut aria-hidden />}>
                {t('confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <FormField label={t('reason')}>
              <Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
    </Rise>
  );
}
