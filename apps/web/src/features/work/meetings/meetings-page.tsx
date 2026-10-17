'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Copy, Users, Video, X } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Panel, Select, Skeleton, Textarea, useToast } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { isoToIstLocal, istLocalToIso } from '@/features/work/attendance/attendance-logic';
import {
  useCancelMeeting, useCreateMeeting, useMeetingDetail, useMeetingOptions, useMeetings,
  type MeetingAudience, type MeetingFilters, type MeetingRow, type MeetingStatus,
} from '@/lib/api/hooks/meetings';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240] as const;
const STATUSES: readonly MeetingStatus[] = ['UPCOMING', 'LIVE', 'ENDED', 'CANCELLED'];
const TONE: Record<MeetingStatus, 'blue' | 'green' | 'neutral' | 'red'> = { UPCOMING: 'blue', LIVE: 'green', ENDED: 'neutral', CANCELLED: 'red' };

/** Next quarter hour, as a datetime-local value in IST. */
export function defaultStart(now = new Date()): string {
  const q = 15 * 60_000;
  return isoToIstLocal(new Date(Math.ceil(now.getTime() / q) * q).toISOString());
}

/** HR, Founder and Developer: announce an extra Zoom meeting, choose who gets it, see who joined, filter the list. */
export function MeetingsPage() {
  const t = useTranslations('meetings');
  return (
    <RequirePermission permission="meetings:manage">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <NewMeeting />
      <MeetingList />
    </RequirePermission>
  );
}

function NewMeeting() {
  const t = useTranslations('meetings');
  const tr = useTranslations('homeLayout');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const opts = useMeetingOptions();
  const create = useCreateMeeting();
  const [title, setTitle] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [start, setStart] = React.useState(() => defaultStart());
  const [duration, setDuration] = React.useState(60);
  const [note, setNote] = React.useState('');
  const [everyone, setEveryone] = React.useState(true);
  const [roles, setRoles] = React.useState<string[]>([]);
  const [teamIds, setTeamIds] = React.useState<string[]>([]);
  const [userIds, setUserIds] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const people = (opts.data?.people ?? []).filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 40);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const startsAt = istLocalToIso(start);
    if (title.trim().length < 3) return setError(t('errTitle'));
    if (!/^https:\/\//i.test(url.trim())) return setError(t('errLink'));
    if (!startsAt) return setError(t('errStart'));
    if (!everyone && roles.length + teamIds.length + userIds.length === 0) return setError(t('needAudience'));
    create.mutate(
      { title: title.trim(), url: url.trim(), startsAt, durationMinutes: duration, ...(note.trim() ? { note: note.trim() } : {}), audience: { everyone, roles: (everyone ? [] : roles) as MeetingAudience['roles'], teamIds: everyone ? [] : teamIds, userIds: everyone ? [] : userIds } },
      {
        onSuccess: (r) => {
          toast({ tone: 'success', title: t('created', { n: r.invitedCount }) });
          setTitle(''); setUrl(''); setNote(''); setStart(defaultStart()); setRoles([]); setTeamIds([]); setUserIds([]); setEveryone(true);
        },
        onError: (err) => setError(apiErr(err).message),
      },
    );
  };

  return (
    <Panel accent="gold" title={t('newTitle')} className="mb-6">
      <form onSubmit={submit} noValidate className="grid gap-3 md:grid-cols-2" aria-label={t('newTitle')}>
        {error && <Alert tone="danger" className="md:col-span-2">{error}</Alert>}
        <FormField label={t('fTitle')} required><Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></FormField>
        <FormField label={t('fLink')} required hint={t('fLinkHint')}><Input type="url" inputMode="url" placeholder="https://zoom.us/j/..." value={url} onChange={(e) => setUrl(e.target.value)} /></FormField>
        <FormField label={t('fStart')} required><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
        <FormField label={t('fDuration')}>
          <Select value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATIONS.map((d) => <option key={d} value={d}>{d < 60 ? t('min', { n: d }) : d === 60 ? t('hour', { n: 1 }) : d % 60 === 0 ? t('hours', { n: d / 60 }) : t('min', { n: d })}</option>)}
          </Select>
        </FormField>
        <FormField label={t('fNote')} className="md:col-span-2"><Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>

        <fieldset className="md:col-span-2">
          <legend className="mb-1 text-sm font-medium text-ink">{t('whoFor')}</legend>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink"><input type="radio" name="aud" checked={everyone} onChange={() => setEveryone(true)} />{t('everyone')}</label>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink"><input type="radio" name="aud" checked={!everyone} onChange={() => setEveryone(false)} />{t('selected')}</label>
          </div>
          {!everyone && (
            <div className="mt-2 grid gap-4 rounded-lg border border-line p-3 md:grid-cols-3">
              <div>
                <p className="mb-1 text-sm font-medium text-ink">{t('pickRoles')}</p>
                {opts.isLoading ? <Skeleton className="h-20 w-full" /> : (opts.data?.roles ?? []).map((r) => (
                  <label key={r} className="flex min-h-9 items-center gap-2 text-sm text-ink"><Checkbox checked={roles.includes(r)} onCheckedChange={() => toggle(roles, setRoles, r)} aria-label={tr(`roles.${r}` as never)} />{tr(`roles.${r}` as never)}</label>
                ))}
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-ink">{t('pickTeams')}</p>
                {(opts.data?.teams ?? []).map((tm) => (
                  <label key={tm.id} className="flex min-h-9 items-center gap-2 text-sm text-ink"><Checkbox checked={teamIds.includes(tm.id)} onCheckedChange={() => toggle(teamIds, setTeamIds, tm.id)} aria-label={tm.name} />{tm.name}</label>
                ))}
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-ink">{t('pickPeople')} <span className="text-muted">({t('chosen', { n: userIds.length })})</span></p>
                <Input aria-label={t('searchPeople')} placeholder={t('searchPeople')} value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="mt-1 max-h-40 overflow-y-auto">
                  {people.length === 0 ? <p className="py-2 text-sm text-muted">{t('noPeople')}</p> : people.map((p) => (
                    <label key={p.id} className="flex min-h-9 items-center gap-2 text-sm text-ink"><Checkbox checked={userIds.includes(p.id)} onCheckedChange={() => toggle(userIds, setUserIds, p.id)} aria-label={p.name} />{p.name}</label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </fieldset>
        <div className="md:col-span-2"><Button type="submit" className="min-h-11" leadingIcon={<Video aria-hidden="true" />} loading={create.isPending}>{t('create')}</Button></div>
      </form>
    </Panel>
  );
}

function MeetingList() {
  const t = useTranslations('meetings');
  const tr = useTranslations('homeLayout');
  const locale = useLocale();
  const { toast } = useToast();
  const opts = useMeetingOptions();
  const cancel = useCancelMeeting();
  const [f, setF] = React.useState<MeetingFilters>({ status: '', audience: '' });
  const [q, setQ] = React.useState('');
  React.useEffect(() => { const id = setTimeout(() => setF((s) => ({ ...s, q: q || undefined })), 300); return () => clearTimeout(id); }, [q]);
  const list = useMeetings(f);
  const [who, setWho] = React.useState<MeetingRow | null>(null);
  const [cancelling, setCancelling] = React.useState<MeetingRow | null>(null);
  const set = (k: keyof MeetingFilters, v: string) => setF((s) => ({ ...s, [k]: v || undefined }));
  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-IN' : locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const audienceText = (a: MeetingAudience) => a.everyone ? t('audienceEveryone') : [
    a.roles.length ? t('audienceRoles', { list: a.roles.map((r) => tr(`roles.${r}` as never)).join(', ') }) : '',
    a.teamIds.length ? t('audienceTeams', { n: a.teamIds.length }) : '',
    a.userIds.length ? t('audiencePeople', { n: a.userIds.length }) : '',
  ].filter(Boolean).join(' · ');
  const filtered = Boolean(f.q || f.status || f.audience || f.roleKey || f.teamId || f.userId || f.from || f.to);
  return (
    <Panel accent="blue" title={t('listTitle')}>
      <div role="search" aria-label={t('filters')} className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t('fSearch')}><Input value={q} onChange={(e) => setQ(e.target.value)} /></FormField>
        <FormField label={t('fStatus')}>
          <Select value={f.status ?? ''} onChange={(e) => set('status', e.target.value)}><option value="">{t('all')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</Select>
        </FormField>
        <FormField label={t('fAudience')}>
          <Select value={f.audience ?? ''} onChange={(e) => set('audience', e.target.value)}><option value="">{t('all')}</option><option value="EVERYONE">{t('audienceEveryone')}</option><option value="SELECTED">{t('selected')}</option></Select>
        </FormField>
        <FormField label={t('fRole')}>
          <Select value={f.roleKey ?? ''} onChange={(e) => set('roleKey', e.target.value)}><option value="">{t('all')}</option>{(opts.data?.roles ?? []).map((r) => <option key={r} value={r}>{tr(`roles.${r}` as never)}</option>)}</Select>
        </FormField>
        <FormField label={t('fTeam')}>
          <Select value={f.teamId ?? ''} onChange={(e) => set('teamId', e.target.value)}><option value="">{t('all')}</option>{(opts.data?.teams ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
        </FormField>
        <FormField label={t('fPerson')}>
          <Select value={f.userId ?? ''} onChange={(e) => set('userId', e.target.value)}><option value="">{t('all')}</option>{(opts.data?.people ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
        </FormField>
        <FormField label={t('fFrom')}><Input type="date" value={f.from ?? ''} onChange={(e) => set('from', e.target.value)} /></FormField>
        <FormField label={t('fTo')}><Input type="date" value={f.to ?? ''} onChange={(e) => set('to', e.target.value)} /></FormField>
        {filtered && <div className="flex items-end"><Button variant="secondary" className="min-h-11" leadingIcon={<X aria-hidden="true" />} onClick={() => { setQ(''); setF({ status: '', audience: '' }); }}>{t('clear')}</Button></div>}
      </div>

      {list.isLoading ? <Skeleton className="h-32 w-full" /> : list.isError ? (
        <Alert tone="danger">{t('loadError')} <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>{t('retry')}</Button></Alert>
      ) : (list.data?.length ?? 0) === 0 ? <EmptyState title={t('emptyTitle')} description={t('emptyBody')} /> : (
        <ul className="space-y-3" aria-label={t('listTitle')}>
          {list.data!.map((m) => (
            <li key={m.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{m.title}</p>
                  <p className="text-sm text-muted">{fmt.format(new Date(m.startsAt))} · {t('by', { name: m.createdByName })}</p>
                  <p className="mt-1 text-sm text-ink-700">{audienceText(m.audience)}</p>
                </div>
                <Badge tone={TONE[m.status]}>{t(`status.${m.status}`)}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted">{t('invited')}: {m.invitedCount} · {t('joinedSummary', { joined: m.joinedCount, invited: m.invitedCount })}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" className="min-h-11" leadingIcon={<Users aria-hidden="true" />} onClick={() => setWho(m)}>{t('who')}</Button>
                <Button size="sm" variant="secondary" className="min-h-11" leadingIcon={<Copy aria-hidden="true" />} onClick={() => { void navigator.clipboard?.writeText(m.url).then(() => toast({ tone: 'success', title: t('copied') })); }}>{t('copyLink')}</Button>
                {(m.status === 'UPCOMING' || m.status === 'LIVE') && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setCancelling(m)}>{t('cancel')}</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {who && <WhoDialog meeting={who} onClose={() => setWho(null)} />}
      {cancelling && (
        <Dialog open onOpenChange={(o) => !o && setCancelling(null)}>
          <DialogContent
            title={t('cancelTitle')} description={t('cancelBody')} closeLabel={t('close')}
            footer={<><Button variant="secondary" onClick={() => setCancelling(null)}>{t('keep')}</Button>
              <Button loading={cancel.isPending} onClick={() => cancel.mutate(cancelling.id, { onSuccess: () => { toast({ tone: 'success', title: t('cancelled') }); setCancelling(null); } })}>{t('cancel')}</Button></>}
          ><p className="text-sm text-ink">{cancelling.title}</p></DialogContent>
        </Dialog>
      )}
    </Panel>
  );
}

function WhoDialog({ meeting, onClose }: { meeting: MeetingRow; onClose: () => void }) {
  const t = useTranslations('meetings');
  const locale = useLocale();
  const d = useMeetingDetail(meeting.id);
  const time = new Intl.DateTimeFormat(locale === 'en' ? 'en-IN' : locale, { timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t('whoTitle', { title: meeting.title })} description={t('joinedSummary', { joined: meeting.joinedCount, invited: meeting.invitedCount })} closeLabel={t('close')} size="lg">
        {d.isLoading ? <Skeleton className="h-24 w-full" /> : d.isError ? <Alert tone="danger">{t('loadError')}</Alert> : (
          <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto" aria-label={t('who')}>
            {(d.data?.invited ?? []).map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="text-ink">{u.name}</span>
                {u.joinedAt ? <Badge tone="green">{t('whoJoined', { time: time.format(new Date(u.joinedAt)) })}</Badge> : <span className="text-muted">{t('whoNot')}</span>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
