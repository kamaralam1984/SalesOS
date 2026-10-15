'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Flame, Plus, ShieldCheck } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, FormField, Input, PageHeader, Select, Textarea } from '@salesos/ui';
import { Can } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ck, useAction, useList, type Escalation } from './api';
import { useAssignable } from './complaints-page';
import { LeadPicker, type PickedLead } from './lead-picker';
import { EscalationStatusBadge, ListShell, NoteDialog, useFmt } from './shared';

const COLUMNS = ['OPEN', 'IN_REVIEW', 'RESOLVED'] as const;

export function EscalationsPage() {
  return (
    <RequirePermission permission="complaints:view">
      <Inner />
    </RequirePermission>
  );
}

type Action = { kind: 'review' | 'resolve' | 'cancel'; e: Escalation } | null;

function Inner() {
  const t = useTranslations('cx');
  const query = useList<Escalation>(ck('escalations'), '/cx/escalations', { limit: 100 });
  const [creating, setCreating] = React.useState(false);
  const [action, setAction] = React.useState<Action>(null);
  const move = useAction<{ id: string; to: string; [k: string]: unknown }, Escalation>('post', (i) => `/cx/escalations/${i.id}/transition`);
  const close = () => { setAction(null); move.reset(); };
  const run = (e: Escalation, to: string, extra: Record<string, unknown>) => move.mutate({ id: e.id, to, ...extra }, { onSuccess: close });

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('escalations.title')} description={t('escalations.description')} actions={<Can permission="complaints:create"><Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />{t('escalations.new')}</Button></Can>} />
      <ListShell query={query} skeletons={3}>
        {query.data && query.data.items.length === 0 ? (
          <EmptyState icon={<Flame className="size-6" aria-hidden="true" />} title={t('escalations.empty')} description={t('escalations.emptyHint')} />
        ) : (
          <div className="enter-up grid gap-4 lg:grid-cols-3">
            {COLUMNS.map((col) => {
              const rows = (query.data?.items ?? []).filter((e) => e.status === col);
              return (
                <section key={col} aria-labelledby={`col-${col}`} className="rounded-lg border border-line bg-ivory-100/60 p-3">
                  <h2 id={`col-${col}`} className="mb-3 flex items-center justify-between font-display text-base font-semibold text-ink">{t(`escalationStatus.${col}`)}<Badge>{rows.length}</Badge></h2>
                  {rows.length === 0 ? <p className="px-1 py-6 text-center text-sm text-muted">{t('escalations.columnEmpty')}</p> : (
                    <ul className="stagger space-y-3">
                      {rows.map((e) => (
                        <li key={e.id}>
                          <EscalationCard e={e} onAction={(kind) => { move.reset(); setAction({ kind, e }); }} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </ListShell>
      <CreateDialog open={creating} onOpenChange={setCreating} />
      {action?.kind === 'review' && (
        <NoteDialog open onOpenChange={(o) => !o && close()} title={t('escalations.startReview')} description={t('escalations.reviewHint')} label={t('escalations.reviewNote')} required={false} submitLabel={t('escalations.startReview')} pending={move.isPending} error={move.error}
          onSubmit={() => run(action.e, 'IN_REVIEW', {})} />
      )}
      {action?.kind === 'resolve' && (
        <NoteDialog open onOpenChange={(o) => !o && close()} title={t('escalations.resolve')} description={t('escalations.resolveHint')} label={t('escalations.resolution')} submitLabel={t('escalations.resolve')} pending={move.isPending} error={move.error}
          onSubmit={(resolution) => run(action.e, 'RESOLVED', { resolution })} />
      )}
      {action?.kind === 'cancel' && (
        <NoteDialog open onOpenChange={(o) => !o && close()} title={t('escalations.cancel')} description={t('escalations.cancelHint')} label={t('complaints.reason')} submitLabel={t('escalations.cancel')} pending={move.isPending} error={move.error}
          onSubmit={(reason) => run(action.e, 'CANCELLED', { reason })} />
      )}
    </>
  );
}

function EscalationCard({ e, onAction }: { e: Escalation; onAction: (k: 'review' | 'resolve' | 'cancel') => void }) {
  const t = useTranslations('cx');
  const fmt = useFmt();
  const openState = e.status === 'OPEN' || e.status === 'IN_REVIEW';
  return (
    <article className="hover-lift rounded-lg border border-line bg-surface p-3.5 shadow-xs" aria-label={e.title}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={e.type === 'HIGH_VALUE' ? 'gold' : 'blue'}>{t(`escalations.type.${e.type}`)}</Badge>
        <EscalationStatusBadge status={e.status} />
        {e.founderInvolved && <Badge tone="gold" icon={<ShieldCheck />}>{t('escalations.founder')}</Badge>}
      </div>
      <h3 className="font-medium text-ink">{e.title}</h3>
      <p className="mt-0.5 text-sm text-muted"><Link className="link-underline text-blue-700" href={`/cx/relationships/${e.leadId}`}>{e.learnerName ?? t('complaints.noLearner')}</Link> · {t('complaints.owner')}: {e.ownerName ?? '—'}</p>
      <p className="mt-2 text-sm text-ink-700">{e.context}</p>
      {e.blocker && <p className="mt-2 text-sm"><span className="font-medium text-ink">{t('escalations.blocker')}: </span>{e.blocker}</p>}
      {e.requestedHelp && <p className="mt-1 text-sm"><span className="font-medium text-ink">{t('escalations.help')}: </span>{e.requestedHelp}</p>}
      {e.teamLeadName && <p className="mt-1 text-xs text-muted">{t('escalations.teamLead')}: {e.teamLeadName}</p>}
      {e.resolution && <p className="mt-2 rounded-md bg-green-50 p-2 text-sm text-green-700">{e.resolution}</p>}
      <p className="mt-2 text-xs text-muted">{fmt.dateTime(e.createdAt)}</p>
      {openState && (
        <Can permission="complaints:update">
          <div className="mt-3 flex flex-wrap gap-2">
            {e.status === 'OPEN' && <Button size="sm" variant="secondary" onClick={() => onAction('review')}>{t('escalations.startReview')}</Button>}
            <Button size="sm" onClick={() => onAction('resolve')}>{t('escalations.resolve')}</Button>
            <Button size="sm" variant="ghost" onClick={() => onAction('cancel')}>{t('escalations.cancel')}</Button>
          </div>
        </Can>
      )}
    </article>
  );
}

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('cx');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('escalations.newTitle')} description={t('escalations.newDescription')} closeLabel={t('common.close')} size="lg">
        {open && <CreateForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('cx');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const people = useAssignable('complaint', true);
  const create = useAction<Record<string, unknown>, Escalation>('post', '/cx/escalations');
  const [lead, setLead] = React.useState<PickedLead | null>(null);
  const [f, setF] = React.useState({ type: 'HIGH_VALUE', title: '', context: '', blocker: '', requestedHelp: '', ownerId: '', founder: false });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const invalid = !lead || f.title.trim().length < 3 || f.context.trim().length < 3;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (invalid || !lead) return; create.mutate({ leadId: lead.id, type: f.type, title: f.title.trim(), context: f.context.trim(), ...(f.blocker.trim() ? { blocker: f.blocker.trim() } : {}), ...(f.requestedHelp.trim() ? { requestedHelp: f.requestedHelp.trim() } : {}), ...(f.ownerId ? { ownerId: f.ownerId } : {}), involveFounder: f.founder }, { onSuccess: onDone }); }}>
      {create.isError && <Alert tone="danger">{apiErr(create.error).message}</Alert>}
      <LeadPicker value={lead} onChange={setLead} label={t('escalations.learner')} required />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('escalations.fieldType')} required>
          <Select value={f.type} onChange={set('type')}><option value="HIGH_VALUE">{t('escalations.type.HIGH_VALUE')}</option><option value="COMPLEX_CONVERSATION">{t('escalations.type.COMPLEX_CONVERSATION')}</option></Select>
        </FormField>
        <FormField label={t('complaints.fieldOwner')} hint={t('escalations.ownerHint')}>
          <Select value={f.ownerId} onChange={set('ownerId')}><option value="">{t('escalations.ownerDefault')}</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </FormField>
      </div>
      <FormField label={t('complaints.fieldTitle')} required><Input value={f.title} onChange={set('title')} maxLength={200} /></FormField>
      <FormField label={t('escalations.context')} required><Textarea value={f.context} onChange={set('context')} maxLength={5000} /></FormField>
      <FormField label={t('escalations.blocker')}><Input value={f.blocker} onChange={set('blocker')} maxLength={2000} /></FormField>
      <FormField label={t('escalations.help')}><Input value={f.requestedHelp} onChange={set('requestedHelp')} maxLength={2000} /></FormField>
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink"><input type="checkbox" className="size-4 accent-gold-600" checked={f.founder} onChange={(e) => setF((p) => ({ ...p, founder: e.target.checked }))} />{t('escalations.involveFounder')}</label>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={create.isPending} disabled={invalid}>{t('escalations.create')}</Button>
      </div>
    </form>
  );
}
