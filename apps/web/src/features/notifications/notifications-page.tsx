'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { BellOff, CheckCheck } from 'lucide-react';
import {
  Alert, Button, EmptyState, ErrorState, FormField, Input, PageHeader, Panel, Select, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger, useToast,
} from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import {
  useNotificationActions, useNotificationList, useNotificationTypes, usePreferences, useRules, useSavePreferences, useSaveRules,
  type Channel, type NotificationTypeInfo, type PreferencesDto, type RulesDto,
} from '@/lib/api/hooks/platform';
import { NotificationItem } from './notification-item';
import { useNotificationText } from './type-text';

export function NotificationsPage() {
  return (
    <RequirePermission permission="notifications:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('platform.notifications');
  const { can } = useAuth();
  const [tab, setTab] = React.useState('inbox');
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('title')}>
          <TabsTrigger value="inbox">{t('tabInbox')}</TabsTrigger>
          {can('notifications:manage-prefs') && <TabsTrigger value="prefs">{t('tabPrefs')}</TabsTrigger>}
          {can('notifications:config') && <TabsTrigger value="rules">{t('tabRules')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="inbox"><Inbox /></TabsContent>
        {can('notifications:manage-prefs') && <TabsContent value="prefs"><Preferences /></TabsContent>}
        {can('notifications:config') && <TabsContent value="rules"><Rules /></TabsContent>}
      </Tabs>
    </>
  );
}

function Inbox() {
  const t = useTranslations('platform.notifications');
  const text = useNotificationText();
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const [status, setStatus] = React.useState<'ALL' | 'UNREAD'>('ALL');
  const [type, setType] = React.useState('');
  const types = useNotificationTypes();
  const q = useNotificationList({ status, type: type || undefined });
  const { read, dismiss, readAll } = useNotificationActions();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unreadCount ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <FormField label={t('filterStatus')} className="w-40">
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'ALL' | 'UNREAD')}>
            <option value="ALL">{t('all')}</option>
            <option value="UNREAD">{t('unreadOnly')}</option>
          </Select>
        </FormField>
        <FormField label={t('filterType')} className="w-64">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t('allTypes')}</option>
            {(types.data ?? []).map((x) => (
              <option key={x.key} value={x.key}>{text.label(x.key, x.label)}</option>
            ))}
          </Select>
        </FormField>
        <div className="flex-1" />
        <Button variant="secondary" disabled={unread === 0} loading={readAll.isPending} onClick={() => readAll.mutate()} leadingIcon={<CheckCheck aria-hidden="true" className="size-4" />}>
          {t('markAllRead')}
        </Button>
      </div>
      {q.isPending ? (
        <div role="status" className="space-y-2">
          <span className="sr-only">{tc('loading')}</span>
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : q.isError ? (
        <ErrorState description={apiErr(q.error).message} onRetry={() => void q.refetch()} retryLabel={tc('retry')} />
      ) : items.length === 0 ? (
        <EmptyState icon={<BellOff />} title={status === 'UNREAD' ? t('emptyUnreadTitle') : t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface" aria-label={t('listLabel')}>
            {items.map((n) => (
              <NotificationItem key={n.id} n={n} onRead={(id) => read.mutate(id)} onDismiss={(id) => dismiss.mutate(id)} />
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t('loadMore')}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const EXTERNAL: Channel[] = ['EMAIL', 'WHATSAPP', 'SMS', 'CALENDAR'];
const CHANNELS: Channel[] = ['IN_APP', ...EXTERNAL];

function Preferences() {
  const t = useTranslations('platform.notifications');
  const text = useNotificationText();
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const types = useNotificationTypes();
  const prefs = usePreferences();
  const save = useSavePreferences();
  const [local, setLocal] = React.useState<Record<string, boolean>>({});
  const [quiet, setQuiet] = React.useState<{ quietStart: string; quietEnd: string; timezone: string } | null | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);

  if (types.isPending || prefs.isPending) return <Skeleton className="h-64 w-full" />;
  if (types.isError || prefs.isError)
    return <ErrorState description={apiErr(types.error ?? prefs.error).message} onRetry={() => { void types.refetch(); void prefs.refetch(); }} retryLabel={tc('retry')} />;

  const stored = new Map(prefs.data.preferences.map((p) => [`${p.type}|${p.channel}`, p.enabled]));
  const value = (type: NotificationTypeInfo, ch: Channel): boolean => {
    const k = `${type.key}|${ch}`;
    if (k in local) return local[k]!;
    const s = stored.get(k) ?? stored.get(`*|${ch}`);
    return s ?? ch === 'IN_APP';
  };
  const quietEff = quiet === undefined ? prefs.data.quietHours : quiet;
  const dirty = Object.keys(local).length > 0 || quiet !== undefined;
  const orgDef = prefs.data.organisationDefaults;

  async function onSave() {
    setError(null);
    const changes: PreferencesDto['preferences'] = Object.entries(local).map(([k, enabled]) => {
      const [type, channel] = k.split('|') as [string, Channel];
      return { type, channel, enabled };
    });
    try {
      await save.mutateAsync({ preferences: changes, ...(quiet !== undefined ? { quietHours: quiet } : {}) });
      setLocal({});
      setQuiet(undefined);
      toast({ tone: 'success', title: t('saved') });
    } catch (e) {
      setError(apiErr(e).message);
    }
  }

  const grouped = new Map<string, NotificationTypeInfo[]>();
  for (const x of types.data) grouped.set(x.category, [...(grouped.get(x.category) ?? []), x]);

  return (
    <div className="stagger space-y-6">
      <Alert tone="info">{t('externalNote')}</Alert>
      {error && <Alert tone="danger">{error}</Alert>}
      <Panel accent="gold" title={t('quietTitle')} description={t('quietHelp', { start: orgDef.quietStart, end: orgDef.quietEnd, tz: orgDef.timezone })}>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={t('quietStart')}>
            <Input type="time" value={quietEff?.quietStart ?? ''} onChange={(e) => setQuiet({ quietStart: e.target.value, quietEnd: quietEff?.quietEnd ?? orgDef.quietEnd, timezone: quietEff?.timezone ?? orgDef.timezone })} />
          </FormField>
          <FormField label={t('quietEnd')}>
            <Input type="time" value={quietEff?.quietEnd ?? ''} onChange={(e) => setQuiet({ quietStart: quietEff?.quietStart ?? orgDef.quietStart, quietEnd: e.target.value, timezone: quietEff?.timezone ?? orgDef.timezone })} />
          </FormField>
          <FormField label={t('timezone')}>
            <Select value={quietEff?.timezone ?? orgDef.timezone} onChange={(e) => setQuiet({ quietStart: quietEff?.quietStart ?? orgDef.quietStart, quietEnd: quietEff?.quietEnd ?? orgDef.quietEnd, timezone: e.target.value })}>
              {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'].map((z) => <option key={z}>{z}</option>)}
            </Select>
          </FormField>
        </div>
        <div className="mt-3">
          <Button variant="ghost" size="sm" disabled={!quietEff} onClick={() => setQuiet(null)}>{t('useOrgHours')}</Button>
        </div>
      </Panel>
      <Panel accent="blue" title={t('typesTitle')} description={t('typesHelp')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">{t('typesTitle')}</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
                <th scope="col" className="py-2 pr-3">{t('type')}</th>
                {CHANNELS.map((c) => <th key={c} scope="col" className="px-2 py-2 text-center">{t(`channel.${c}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...grouped.entries()].map(([cat, list]) => (
                <React.Fragment key={cat}>
                  <tr><th colSpan={6} scope="colgroup" className="bg-ivory-100 px-2 py-1.5 text-left text-xs font-semibold text-ink-600">{t(`category.${cat}`)}</th></tr>
                  {list.map((x) => (
                    <tr key={x.key} className="border-b border-line/60">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        {text.label(x.key, x.label)}
                        {x.mandatory && <span className="ml-2 text-xs text-muted">{t('alwaysOn')}</span>}
                      </th>
                      {CHANNELS.map((c) => (
                        <td key={c} className="px-2 py-2 text-center">
                          <Switch
                            aria-label={`${text.label(x.key, x.label)} - ${t(`channel.${c}`)}`}
                            checked={c === 'IN_APP' && x.mandatory ? true : value(x, c)}
                            disabled={c === 'IN_APP' && x.mandatory}
                            onCheckedChange={(v) => setLocal((l) => ({ ...l, [`${x.key}|${c}`]: v }))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!dirty} onClick={() => { setLocal({}); setQuiet(undefined); }}>{tc('cancel')}</Button>
        <Button className="glow-gold" disabled={!dirty} loading={save.isPending} onClick={() => void onSave()}>{tc('save')}</Button>
      </div>
    </div>
  );
}

const DAYS = [1, 2, 3, 4, 5, 6, 7];

function Rules() {
  const t = useTranslations('platform.notifications');
  const text = useNotificationText();
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const types = useNotificationTypes();
  const rules = useRules(true);
  const save = useSaveRules();
  const [cfg, setCfg] = React.useState<Partial<RulesDto['orgConfig']>>({});
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>({});
  const [error, setError] = React.useState<string | null>(null);
  if (types.isPending || rules.isPending) return <Skeleton className="h-64 w-full" />;
  if (types.isError || rules.isError) return <ErrorState description={apiErr(types.error ?? rules.error).message} onRetry={() => { void types.refetch(); void rules.refetch(); }} retryLabel={tc('retry')} />;
  const org = { ...rules.data.orgConfig, ...cfg };
  const isOn = (k: string) => enabled[k] ?? rules.data.rules.find((r) => r.type === k)?.enabled ?? true;
  const dirty = Object.keys(cfg).length > 0 || Object.keys(enabled).length > 0;
  async function onSave() {
    setError(null);
    try {
      await save.mutateAsync({ ...(Object.keys(cfg).length ? { orgConfig: cfg } : {}), ...(Object.keys(enabled).length ? { rules: Object.entries(enabled).map(([type, en]) => ({ type, enabled: en })) } : {}) });
      setCfg({});
      setEnabled({});
      toast({ tone: 'success', title: t('saved') });
    } catch (e) {
      setError(apiErr(e).message);
    }
  }
  return (
    <div className="stagger space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      <Panel accent="green" title={t('orgHoursTitle')} description={t('orgHoursHelp')}>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={t('quietStart')}><Input type="time" value={org.quietStart} onChange={(e) => setCfg((c) => ({ ...c, quietStart: e.target.value }))} /></FormField>
          <FormField label={t('quietEnd')}><Input type="time" value={org.quietEnd} onChange={(e) => setCfg((c) => ({ ...c, quietEnd: e.target.value }))} /></FormField>
          <FormField label={t('timezone')}>
            <Select value={org.timezone} onChange={(e) => setCfg((c) => ({ ...c, timezone: e.target.value }))}>
              {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'].map((z) => <option key={z}>{z}</option>)}
            </Select>
          </FormField>
          <FormField label={t('digestThreshold')} hint={t('digestHelp')}>
            <Input type="number" min={2} max={100} value={org.digestThreshold} onChange={(e) => setCfg((c) => ({ ...c, digestThreshold: Number(e.target.value) }))} />
          </FormField>
          <FormField label={t('digestWindow')}>
            <Input type="number" min={5} max={1440} value={org.digestWindowMinutes} onChange={(e) => setCfg((c) => ({ ...c, digestWindowMinutes: Number(e.target.value) }))} />
          </FormField>
        </div>
        <fieldset className="mt-4">
          <legend className="mb-1 text-sm font-medium text-ink">{t('workingDays')}</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((d) => (
              <label key={d} className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={org.workingDays.includes(d)}
                  onChange={(e) => setCfg((c) => ({ ...c, workingDays: e.target.checked ? [...new Set([...org.workingDays, d])].sort() : org.workingDays.filter((x) => x !== d) }))}
                />
                {t(`day.${d}`)}
              </label>
            ))}
          </div>
        </fieldset>
      </Panel>
      <Panel accent="gold" title={t('rulesTitle')} description={t('rulesHelp')}>
        <ul className="divide-y divide-line">
          {types.data.map((x) => (
            <li key={x.key}>
              <Switch label={text.label(x.key, x.label)} description={x.mandatory ? t('alwaysOn') : t(`category.${x.category}`)} checked={x.mandatory ? true : isOn(x.key)} disabled={x.mandatory} onCheckedChange={(v) => setEnabled((e) => ({ ...e, [x.key]: v }))} />
            </li>
          ))}
        </ul>
      </Panel>
      <div className="flex justify-end">
        <Button className="glow-gold" disabled={!dirty} loading={save.isPending} onClick={() => void onSave()}>{tc('save')}</Button>
      </div>
    </div>
  );
}
