'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarPlus, UserPlus } from 'lucide-react';
import { Alert, Badge, Button, Combobox, DataTable, DatePicker, Dialog, DialogContent, FormField, Input, Panel, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast, type Column } from '@salesos/ui';
import { PageHeader } from './motion';
import { RequirePermission } from '@/features/auth/require-permission';
import { Can } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useLeads, useLeadMeta } from '@/lib/api/hooks/crm';
import {
  NEXT_ATTENDANCE,
  useAttendees,
  useCreateEvent,
  useEvent,
  useEvents,
  useSetAttendance,
  useUpdateEvent,
  type Attendee,
  type AttendanceStatus,
  type CrmEvent,
} from '@/lib/api/hooks/crm-admin';
import { CrmFrame, DataState, useCrmFormat } from './common';
import { fromIstInput, humanize, quickPick } from './lib';

export function EventsPage() {
  return (
    <RequirePermission permission="events:view">
      <CrmFrame>
        <EventsInner />
      </CrmFrame>
    </RequirePermission>
  );
}

function EventsInner() {
  const t = useTranslations('crm.events');
  const tc = useTranslations('common');
  const tt = useTranslations('crm.common');
  const f = useCrmFormat();
  const router = useRouter();
  const err = useApiErrorMessage();
  const [type, setType] = React.useState('ALL');
  const [create, setCreate] = React.useState(false);
  const q = useEvents({ type: type === 'ALL' ? undefined : type });
  const columns: Column<CrmEvent>[] = [
    { id: 'title', header: t('colTitle'), primary: true, cell: (e) => (<Link href={`/crm/events/${e.id}`} className="link-underline font-medium text-ink">{e.title}</Link>) },
    { id: 'type', header: t('colType'), cell: (e) => tt(`eventType.${e.type}` as 'eventType.WEBINAR') },
    { id: 'when', header: t('colWhen'), cell: (e) => f.dateTime(e.startsAt) },
    { id: 'status', header: t('colStatus'), cell: (e) => <Badge tone={e.status === 'SCHEDULED' ? 'blue' : e.status === 'COMPLETED' ? 'green' : 'red'}>{humanize(e.status)}</Badge> },
    { id: 'att', header: t('colAttendance'), hideOnMobile: true, cell: (e) => t('counts', { registered: e.counts?.REGISTERED ?? 0, attended: e.counts?.ATTENDED ?? 0 }) },
  ];
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={<Can permission="events:manage"><Button leadingIcon={<CalendarPlus className="size-4" aria-hidden="true" />} onClick={() => setCreate(true)}>{t('new')}</Button></Can>}
      />
      <Tabs value={type} onValueChange={setType} className="enter-up mb-4 max-w-full overflow-x-auto">
        <TabsList aria-label={t('filterType')}>
          <TabsTrigger value="ALL">{t('all')}</TabsTrigger>
          <TabsTrigger value="WEBINAR">{tt('eventType.WEBINAR')}</TabsTrigger>
          <TabsTrigger value="DEMO">{tt('eventType.DEMO')}</TabsTrigger>
          <TabsTrigger value="EVENT">{tt('eventType.EVENT')}</TabsTrigger>
        </TabsList>
        {['ALL', 'WEBINAR', 'DEMO', 'EVENT'].map((v) => (<TabsContent key={v} value={v} />))}
      </Tabs>
      <DataTable
        caption={t('title')}
        columns={columns}
        rows={q.data}
        getRowId={(e) => e.id}
        loading={q.isPending}
        loadingLabel={tc('loading')}
        error={q.isError ? { message: err(q.error).message, onRetry: () => void q.refetch() } : null}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        onRowClick={(e) => router.push(`/crm/events/${e.id}`)}
      />
      {create && <CreateEventDialog onClose={() => setCreate(false)} />}
    </>
  );
}

function CreateEventDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('crm.events');
  const tc = useTranslations('common');
  const tt = useTranslations('crm.common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const meta = useLeadMeta();
  const create = useCreateEvent();
  const [v, setV] = React.useState({ type: 'WEBINAR', title: '', startsAt: quickPick('tomorrow10'), duration: '90', programId: '', capacity: '' });
  const [error, setError] = React.useState<string | null>(null);
  const titleErr = !v.title.trim() ? t('titleRequired') : null;
  const [touched, setTouched] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="md"
        title={t('createTitle')}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>{tc('cancel')}</Button>
            <Button
              loading={create.isPending}
              onClick={async () => {
                setTouched(true);
                if (titleErr) return;
                const startIso = fromIstInput(v.startsAt);
                if (!startIso) return setError(t('startRequired'));
                setError(null);
                try {
                  await create.mutateAsync({
                    type: v.type,
                    title: v.title.trim(),
                    startsAt: startIso,
                    endsAt: new Date(new Date(startIso).getTime() + Number(v.duration || 60) * 60_000).toISOString(),
                    programId: v.programId || null,
                    capacity: v.capacity ? Number(v.capacity) : null,
                  });
                  toast({ tone: 'success', title: t('created') });
                  onClose();
                } catch (e) {
                  setError(apiErr(e).message);
                }
              }}
            >
              {t('create')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label={t('type')}>
            <Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
              {(['WEBINAR', 'DEMO', 'EVENT'] as const).map((x) => (<option key={x} value={x}>{tt(`eventType.${x}`)}</option>))}
            </Select>
          </FormField>
          <FormField label={t('fieldTitle')} required error={touched ? titleErr : null}>
            <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
          </FormField>
          <FormField label={t('startsAt')} required>
            <DatePicker mode="datetime-local" value={v.startsAt} onValueChange={(x) => setV({ ...v, startsAt: x })} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('duration')}><Input inputMode="numeric" value={v.duration} onChange={(e) => setV({ ...v, duration: e.target.value })} /></FormField>
            <FormField label={t('capacity')}><Input inputMode="numeric" value={v.capacity} onChange={(e) => setV({ ...v, capacity: e.target.value })} /></FormField>
          </div>
          <FormField label={t('program')}>
            <Select value={v.programId} onChange={(e) => setV({ ...v, programId: e.target.value })}>
              <option value="">{t('none')}</option>
              {(meta.data?.programs ?? []).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </Select>
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- detail + attendance */
export function EventDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission permission="events:view">
      <CrmFrame>
        <EventDetailInner id={id} />
      </CrmFrame>
    </RequirePermission>
  );
}

/** Which next states are offered, and why a state may be blocked right now (time rules mirror the API). */
export function attendanceOptions(status: AttendanceStatus, event: Pick<CrmEvent, 'startsAt' | 'endsAt' | 'status'>, now = Date.now()) {
  const ended = new Date(event.endsAt ?? event.startsAt).getTime() <= now;
  const started = new Date(event.startsAt).getTime() - now <= 3600_000;
  return NEXT_ATTENDANCE[status].map((s) => ({
    status: s,
    blocked: s === 'NO_SHOW' && !ended ? 'notEnded' : s === 'ATTENDED' && !started ? 'notStarted' : s === 'REGISTERED' && event.status !== 'SCHEDULED' ? 'closed' : null,
  }));
}

function EventDetailInner({ id }: { id: string }) {
  const t = useTranslations('crm.events');
  const tc = useTranslations('common');
  const tt = useTranslations('crm.common');
  const f = useCrmFormat();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const ev = useEvent(id);
  const att = useAttendees(id);
  const set = useSetAttendance();
  const update = useUpdateEvent();
  const [error, setError] = React.useState<string | null>(null);
  const [warn, setWarn] = React.useState<string[]>([]);
  const [add, setAdd] = React.useState(false);
  const [cancel, setCancel] = React.useState<Attendee | null>(null);
  const [resched, setResched] = React.useState<Attendee | null>(null);

  const run = async (a: Attendee, status: AttendanceStatus, extra: { reason?: string; newEventId?: string } = {}) => {
    setError(null);
    setWarn([]);
    try {
      const r = await set.mutateAsync({ eventId: id, leadId: a.lead.id, status, ...extra });
      setWarn(r.warnings);
      toast({ tone: 'success', title: t('attendanceUpdated', { name: a.lead.fullName }) });
    } catch (e) {
      setError(apiErr(e).message);
    }
  };

  return (
    <DataState q={ev} empty={{ title: t('notFound') }}>
      {(e) => (
        <>
          <PageHeader
            eyebrow={tt(`eventType.${e.type}` as 'eventType.WEBINAR')}
            title={e.title}
            description={`${f.dateTime(e.startsAt)} · ${humanize(e.status)}${e.capacity ? ` · ${t('capacityOf', { n: e.capacity })}` : ''}`}
            breadcrumbs={[{ label: t('title'), href: '/crm/events' }, { label: e.title }]}
            breadcrumbLabel={tc('breadcrumb')}
            actions={
              <Can permission="events:manage">
                <Button variant="secondary" onClick={() => setAdd(true)} leadingIcon={<UserPlus className="size-4" aria-hidden="true" />}>{t('addLead')}</Button>
                {e.status === 'SCHEDULED' && <Button variant="secondary" loading={update.isPending} onClick={() => update.mutate({ id, status: 'COMPLETED' })}>{t('markCompleted')}</Button>}
                {e.status === 'SCHEDULED' && <Button variant="ghost" onClick={() => update.mutate({ id, status: 'CANCELLED' })}>{t('cancelEvent')}</Button>}
              </Can>
            }
          />
          {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
          {warn.map((w) => (<Alert key={w} tone="warning" className="mb-3">{w}</Alert>))}
          <Panel title={t('attendees')} description={t('machineHint')} className="enter-up">
            <DataState q={att} isEmpty={(d) => d.length === 0} empty={{ title: t('noAttendees'), description: t('noAttendeesHint') }}>
              {(rows) => (
                <ul className="stagger-fast divide-y divide-line" aria-label={t('attendees')}>
                  {rows.map((a) => {
                    const opts = attendanceOptions(a.status, e);
                    return (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm transition-colors hover:bg-ivory-100" data-attendee-id={a.id}>
                        <div className="min-w-0 break-words">
                          <Link href={`/crm/leads/${a.lead.id}`} className="link-underline font-medium text-ink">{a.lead.fullName}</Link>
                          <Badge className="ml-2" tone={a.status === 'ATTENDED' ? 'green' : a.status === 'NO_SHOW' || a.status === 'CANCELLED' ? 'red' : 'neutral'}>{t(`st.${a.status}` as 'st.INVITED')}</Badge>
                          {a.reason && <p className="text-xs text-muted">{a.reason}</p>}
                        </div>
                        <Can permission="events:manage">
                          <div className="flex flex-wrap gap-2">
                            {opts.length === 0 && <span className="text-xs text-muted">{t('noFurther')}</span>}
                            {opts.map((o) => (
                              <span key={o.status} title={o.blocked ? t(`blocked.${o.blocked}` as 'blocked.notEnded') : undefined}>
                                <Button
                                  size="sm"
                                  variant={o.status === 'CANCELLED' ? 'ghost' : 'secondary'}
                                  disabled={Boolean(o.blocked) || set.isPending}
                                  onClick={() => (o.status === 'CANCELLED' ? setCancel(a) : o.status === 'RESCHEDULED' ? setResched(a) : void run(a, o.status))}
                                >
                                  {t(`do.${o.status}` as 'do.ATTENDED')}
                                </Button>
                              </span>
                            ))}
                          </div>
                        </Can>
                      </li>
                    );
                  })}
                </ul>
              )}
            </DataState>
          </Panel>
          {add && <AddLeadDialog eventId={id} onClose={() => setAdd(false)} />}
          {cancel && <ReasonDialog title={t('cancelTitle', { name: cancel.lead.fullName })} label={t('cancelReason')} onClose={() => setCancel(null)} onSubmit={async (reason) => { await run(cancel, 'CANCELLED', { reason }); setCancel(null); }} />}
          {resched && <RescheduleDialog current={id} onClose={() => setResched(null)} onSubmit={async (newEventId) => { await run(resched, 'RESCHEDULED', { newEventId }); setResched(null); }} />}
        </>
      )}
    </DataState>
  );
}

function ReasonDialog({ title, label, onClose, onSubmit }: { title: string; label: string; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const tc = useTranslations('common');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title={title} closeLabel={tc('close')} footer={<><Button variant="secondary" onClick={onClose}>{tc('cancel')}</Button><Button loading={busy} disabled={reason.trim().length < 3} onClick={async () => { setBusy(true); await onSubmit(reason.trim()); setBusy(false); }}>{tc('save')}</Button></>}>
        <FormField label={label} required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      </DialogContent>
    </Dialog>
  );
}

function RescheduleDialog({ current, onClose, onSubmit }: { current: string; onClose: () => void; onSubmit: (id: string) => Promise<void> }) {
  const t = useTranslations('crm.events');
  const tc = useTranslations('common');
  const f = useCrmFormat();
  const events = useEvents({ upcoming: true });
  const [pick, setPick] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title={t('rescheduleTitle')} closeLabel={tc('close')} footer={<><Button variant="secondary" onClick={onClose}>{tc('cancel')}</Button><Button loading={busy} disabled={!pick} onClick={async () => { setBusy(true); await onSubmit(pick); setBusy(false); }}>{t('reschedule')}</Button></>}>
        <FormField label={t('newEvent')} required>
          <Select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{t('choose')}</option>
            {(events.data ?? []).filter((x) => x.id !== current).map((x) => (<option key={x.id} value={x.id}>{x.title} · {f.dateTime(x.startsAt)}</option>))}
          </Select>
        </FormField>
      </DialogContent>
    </Dialog>
  );
}

function AddLeadDialog({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const t = useTranslations('crm.events');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const set = useSetAttendance();
  const [query, setQuery] = React.useState('');
  const [lead, setLead] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<'INVITED' | 'REGISTERED'>('REGISTERED');
  const [error, setError] = React.useState<string | null>(null);
  const leads = useLeads({ q: query || undefined, limit: 20, category: 'OPEN' });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="md"
        title={t('addLeadTitle')}
        closeLabel={tc('close')}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>{tc('cancel')}</Button>
            <Button
              loading={set.isPending}
              disabled={!lead}
              onClick={async () => {
                setError(null);
                try {
                  await set.mutateAsync({ eventId, leadId: lead!, status });
                  toast({ tone: 'success', title: t('leadAdded') });
                  onClose();
                } catch (e) {
                  setError(apiErr(e).message);
                }
              }}
            >
              {t('add')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <FormField label={t('lead')} required>
            <Combobox options={(leads.data?.items ?? []).map((l) => ({ value: l.id, label: l.fullName, description: l.phone ?? undefined }))} value={lead} onValueChange={setLead} onQueryChange={setQuery} loading={leads.isFetching} placeholder={t('searchLead')} emptyText={tc('noMatches')} clearLabel={tc('clear')} />
          </FormField>
          <FormField label={t('initialStatus')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as 'INVITED' | 'REGISTERED')}>
              <option value="REGISTERED">{t('st.REGISTERED')}</option>
              <option value="INVITED">{t('st.INVITED')}</option>
            </Select>
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}
