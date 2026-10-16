'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, RotateCcw, ShieldAlert } from 'lucide-react';
import {
  Alert, Badge, Button, Dialog, DialogContent, EmptyState, ErrorState, FormField, Input, LoadingRegion, PageHeader, Panel, Select, Skeleton, Switch, Tabs, TabsList, TabsTrigger, useToast,
} from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { useAuth } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ApiError } from '@/lib/api/client';
import { ROLE_KEYS, type RoleKey } from '@/lib/api/types';
import { useDevUsers } from '@/lib/api/hooks/devpanel';
import {
  useChangeFeatures, useFeatureSummary, useFeatureView, useResetFeatures,
  type FeatureChange, type FeatureRow, type FeatureScope, type FeatureView, type SubjectType,
} from '@/lib/api/hooks/devpanel-features';
import { buildScreens, screenChanges, screenReset, screenState, type Screen } from './feature-screens';

const SCOPES: FeatureScope[] = ['own', 'team', 'org'];
const EDITABLE_ROLES = ROLE_KEYS.filter((r) => r !== 'DEVELOPER');

export function FeaturesPage() {
  return (
    <RequirePermission permission="devpanel:features:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('devFeatures');
  const tr = useTranslations('roles');
  const { can } = useAuth();
  const [type, setType] = React.useState<SubjectType>('ROLE');
  const [role, setRole] = React.useState<RoleKey>('SALES_EXECUTIVE');
  const [userId, setUserId] = React.useState('');
  const subject = type === 'ROLE' ? role : userId;
  const summary = useFeatureSummary();

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={<Link href="/admin/developer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><ArrowLeft aria-hidden className="size-4" />{t('back')}</Link>}
      />
      <Panel>
        <Tabs value={type} onValueChange={(v) => setType(v as SubjectType)}>
          <TabsList aria-label={t('subjectLabel')}>
            <TabsTrigger value="ROLE">{t('byRole')}</TabsTrigger>
            <TabsTrigger value="USER">{t('byUser')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="mt-4 max-w-md">
          {type === 'ROLE' ? (
            <FormField label={t('pickRole')}>
              <Select value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
                {EDITABLE_ROLES.map((r) => <option key={r} value={r}>{tr(r)}</option>)}
              </Select>
            </FormField>
          ) : (
            <UserPicker value={userId} onChange={setUserId} />
          )}
        </div>
        {summary.data && summary.data.subjects.length > 0 && (
          <div className="mt-4" aria-label={t('customisedList')}>
            <p className="mb-1.5 text-xs font-medium text-muted">{t('customisedList')}</p>
            <div className="flex flex-wrap gap-2">
              {summary.data.subjects.map((s) => (
                <button
                  key={`${s.type}:${s.key}`}
                  type="button"
                  onClick={() => { setType(s.type); if (s.type === 'ROLE') setRole(s.key as RoleKey); else setUserId(s.key); }}
                  className="min-h-9 rounded-full border border-line bg-ivory-100 px-3 text-xs text-ink hover:border-gold-300 focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {s.type === 'ROLE' ? tr(s.key as RoleKey) : s.label}
                  <span className="ml-2 text-muted">{t('chipCounts', { on: s.grants, off: s.denies })}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>
      {!subject ? (
        <div className="mt-4"><EmptyState title={t('pickUserFirst')} /></div>
      ) : (
        <Editor key={`${type}:${subject}`} type={type} subject={subject} canManage={can('devpanel:features:manage')} />
      )}
    </>
  );
}

function UserPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useTranslations('devFeatures');
  const me = useAuth().user;
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const q = useDevUsers(debounced ? { search: debounced } : {});
  // a Developer's access is managed by role assignment, and you cannot change your own
  const users = (q.data ?? []).filter((u) => u.id !== me?.id && !u.roles.includes('DEVELOPER'));
  return (
    <div className="space-y-3">
      <FormField label={t('searchUser')}><Input value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} /></FormField>
      <FormField label={t('pickUser')}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{q.isPending ? '…' : t('chooseUser')}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
        </Select>
      </FormField>
    </div>
  );
}

type Filter = 'all' | 'on' | 'off' | 'custom';

function Editor({ type, subject, canManage }: { type: SubjectType; subject: string; canManage: boolean }) {
  const t = useTranslations('devFeatures');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const q = useFeatureView(type, subject);
  const change = useChangeFeatures(type, subject);
  const reset = useResetFeatures(type, subject);
  const [view, setView] = React.useState<'screens' | 'all'>('screens');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<{ changes: FeatureChange[]; keys: string[] } | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const rows = React.useMemo(() => new Map((q.data?.permissions ?? []).map((r) => [r.key, r])), [q.data]);

  function send(changes: FeatureChange[], busyId: string, confirmSensitive = false) {
    if (!changes.length) return;
    setError(null);
    setBusy(busyId);
    change.mutate({ changes, confirmSensitive }, {
      onSuccess: () => { setPending(null); toast({ tone: 'success', title: t('saved') }); },
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'CONFIRM_SENSITIVE') {
          const keys = Array.isArray(e.details) ? (e.details as Array<{ path?: string }>).map((d) => d.path ?? '').filter(Boolean) : changes.map((c) => c.permissionKey);
          setPending({ changes, keys });
        } else setError(apiErr(e).message);
      },
      onSettled: () => setBusy(null),
    });
  }

  if (q.isPending) return <LoadingRegion label={tc('loading')} className="mt-4 space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></LoadingRegion>;
  if (q.isError) return <div className="mt-4"><ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} /></div>;
  const data = q.data as FeatureView;

  return (
    <div className="mt-4 space-y-4" aria-busy={change.isPending}>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">{data.subject.label}</h2>
            <p className="text-sm text-muted">{t('stats', { enabled: data.enabled, total: data.total })} · {t('customCount', { count: data.overrides })}</p>
            {type === 'USER' && <p className="mt-1 text-xs text-muted">{t('inherits', { roles: data.subject.roles.join(', ') || '—' })}</p>}
          </div>
          {canManage && (
            <Button variant="secondary" leadingIcon={<RotateCcw aria-hidden />} disabled={data.overrides === 0 || reset.isPending} loading={reset.isPending} onClick={() => setConfirmReset(true)}>{t('resetAll')}</Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">{t('appliesNote')}</p>
      </Panel>
      {error && <Alert tone="danger">{error}</Alert>}
      <Tabs value={view} onValueChange={(v) => setView(v as 'screens' | 'all')}>
        <TabsList aria-label={t('viewLabel')}>
          <TabsTrigger value="screens">{t('tabScreens')}</TabsTrigger>
          <TabsTrigger value="all">{t('tabAll')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {view === 'screens'
        ? <ScreensList rows={rows} canManage={canManage} busy={busy} onChange={send} />
        : <AllFeatures rows={data.permissions} canManage={canManage} busy={busy} onChange={send} />}

      <Dialog open={Boolean(pending)} onOpenChange={(o) => !o && setPending(null)}>
        {pending && (
          <DialogContent size="md" title={t('confirmTitle')} description={t('confirmBody')} closeLabel={tc('close')}
            footer={<><Button variant="secondary" onClick={() => setPending(null)}>{tc('cancel')}</Button><Button loading={change.isPending} onClick={() => send(pending.changes, 'confirm', true)}>{t('confirmGrant')}</Button></>}>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink">{pending.keys.map((k) => <li key={k}><code className="text-xs">{k}</code>{rows.get(k) ? ` — ${rows.get(k)!.description}` : ''}</li>)}</ul>
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent size="md" title={t('resetTitle')} description={t('resetBody', { name: data.subject.label })} closeLabel={tc('close')}
          footer={<><Button variant="secondary" onClick={() => setConfirmReset(false)}>{tc('cancel')}</Button><Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate(undefined, { onSuccess: (r) => { setConfirmReset(false); toast({ tone: 'success', title: t('resetDone', { count: r.removed }) }); }, onError: (e) => { setConfirmReset(false); setError(apiErr(e).message); } })}>{t('resetAll')}</Button></>}>
          <p className="text-sm text-muted">{t('resetHint')}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type OnChange = (changes: FeatureChange[], busyId: string) => void;

function ScreensList({ rows, canManage, busy, onChange }: { rows: ReadonlyMap<string, FeatureRow>; canManage: boolean; busy: string | null; onChange: OnChange }) {
  const t = useTranslations('devFeatures');
  const tn = useTranslations('nav');
  const groups = React.useMemo(() => {
    const out = new Map<string, { label: string; screens: Screen[] }>();
    for (const s of buildScreens()) {
      // only screens whose keys exist in the catalogue
      if (!s.perms.some((k) => rows.has(k))) continue;
      const g = out.get(s.group) ?? { label: s.groupLabelKey, screens: [] };
      g.screens.push(s);
      out.set(s.group, g);
    }
    return [...out.values()];
  }, [rows]);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('screensHint')}</p>
      {groups.map((g) => (
        <Panel key={g.label} title={tn(g.label as never)}>
          <ul className="divide-y divide-line">
            {g.screens.map((s) => {
              const st = screenState(s, rows);
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{tn(s.labelKey as never)}</p>
                    <p className="text-xs text-muted"><code>{s.href}</code></p>
                  </div>
                  <div className="flex items-center gap-3">
                    {st.customised && <Badge tone="gold">{t('customised')}</Badge>}
                    {st.customised && canManage && (
                      <Button variant="ghost" disabled={busy !== null} onClick={() => onChange(screenReset(s), s.id)}>{t('useDefault')}</Button>
                    )}
                    <Switch
                      aria-label={tn(s.labelKey as never)}
                      checked={st.on}
                      disabled={!canManage || st.locked || busy !== null}
                      onCheckedChange={(on) => onChange(screenChanges(s, rows, on), s.id)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

function AllFeatures({ rows, canManage, busy, onChange }: { rows: FeatureRow[]; canManage: boolean; busy: string | null; onChange: OnChange }) {
  const t = useTranslations('devFeatures');
  const ts = useTranslations('developer.access.scope');
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  const needle = search.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (r.locked) return false;
    if (needle && !(r.key.includes(needle) || r.description.toLowerCase().includes(needle))) return false;
    if (filter === 'on') return Boolean(r.effective);
    if (filter === 'off') return !r.effective;
    if (filter === 'custom') return Boolean(r.override);
    return true;
  });
  const byDomain = new Map<string, FeatureRow[]>();
  for (const r of shown) byDomain.set(r.domain, [...(byDomain.get(r.domain) ?? []), r]);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('search')}><Input value={search} onChange={(e) => setSearch(e.target.value)} maxLength={80} /></FormField>
        <FormField label={t('filter')}>
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">{t('filterAll')}</option>
            <option value="on">{t('filterOn')}</option>
            <option value="off">{t('filterOff')}</option>
            <option value="custom">{t('filterCustom')}</option>
          </Select>
        </FormField>
      </div>
      {shown.length === 0 && <EmptyState title={t('noMatches')} />}
      {[...byDomain.entries()].map(([domain, list]) => (
        <Panel key={domain} title={<span className="capitalize">{domain}</span>}>
          <ul className="divide-y divide-line">
            {list.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 max-w-xl">
                  <p className="text-sm font-medium text-ink">{r.description}</p>
                  <p className="text-xs text-muted"><code>{r.key}</code> · {r.default ? t('defaultScope', { scope: ts(r.default) }) : t('defaultOff')}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {r.sensitive && <Badge tone="red"><span className="inline-flex items-center gap-1"><ShieldAlert aria-hidden className="size-3" />{t('sensitive')}</span></Badge>}
                    {r.override && <Badge tone="gold">{t('customised')}</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {r.effective && canManage && (
                    <Select aria-label={t('scopeFor', { name: r.description })} value={r.effective === 'summary' ? 'own' : r.effective} disabled={busy !== null}
                      onChange={(e) => onChange([{ permissionKey: r.key, state: 'ON', scope: e.target.value as FeatureScope }], r.key)}>
                      {SCOPES.map((s) => <option key={s} value={s}>{ts(s)}</option>)}
                    </Select>
                  )}
                  {r.override && canManage && <Button variant="ghost" disabled={busy !== null} onClick={() => onChange([{ permissionKey: r.key, state: 'DEFAULT' }], r.key)}>{t('useDefault')}</Button>}
                  <Switch aria-label={r.description} checked={Boolean(r.effective)} disabled={!canManage || busy !== null}
                    onCheckedChange={(on) => onChange([on ? { permissionKey: r.key, state: 'ON', scope: r.default ?? 'own' } : { permissionKey: r.key, state: 'OFF' }], r.key)} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
