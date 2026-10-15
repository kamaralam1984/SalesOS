'use client';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Checkbox, Dialog, DialogContent, FormField, Input, PageHeader, Pagination, Textarea, useToast } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { ConfirmDialog, MutationAlert, QueryState, useFormErrors } from '@/features/people/hub/shared';
import { useAnnouncements, useCreateAnnouncement, useDeleteAnnouncement, type Announcement } from '@/lib/api/hooks/work-people';
import { useDates } from '../common';

export function AnnouncementsPage() {
  return (
    <RequirePermission permission="announcements:manage">
      <Inner />
    </RequirePermission>
  );
}

const AUDIENCE = ['FOUNDER_CEO', 'SALES_EXECUTIVE', 'SALES_MANAGER', 'SALES_TEAM_LEAD', 'FINANCE', 'HR', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS', 'ADMIN'] as const;

function Inner() {
  const t = useTranslations('workHr');
  const tc = useTranslations('common');
  const dates = useDates();
  const [page, setPage] = React.useState(1);
  const q = useAnnouncements({ include: 'all', page, limit: 10 });
  const [open, setOpen] = React.useState(false);
  const [del, setDel] = React.useState<Announcement | null>(null);
  const remove = useDeleteAnnouncement();
  const { toast } = useToast();
  return (
    <>
      <PageHeader eyebrow={t('announcements.eyebrow')} title={t('announcements.title')} description={t('announcements.description')} actions={<Button leadingIcon={<Plus aria-hidden="true" />} onClick={() => setOpen(true)}>{t('announcements.new')}</Button>} />
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t('announcements.empty')} emptyDescription={t('announcements.emptyBody')}>
        <ul className="stagger space-y-2" aria-label={t('announcements.title')}>
          {(q.data?.items ?? []).map((a) => (
            <li key={a.id} className="hover-lift rounded-lg border border-line bg-surface p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{a.title}</p>
                  <p className="text-xs text-muted">{t('announcements.meta', { date: dates.dateTime(a.publishedAt), by: a.createdByName ?? '—' })}{a.expiresAt ? ` · ${t('announcements.until', { date: dates.dateTime(a.expiresAt) })}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {a.expired && <Badge tone="neutral">{t('announcements.expired')}</Badge>}
                  <Badge tone="blue">{a.audienceRoles.length === 0 ? t('announcements.everyone') : t('announcements.roles', { n: a.audienceRoles.length })}</Badge>
                  <Button size="sm" variant="ghost" aria-label={t('announcements.deleteAria', { title: a.title })} leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => setDel(a)}>{t('announcements.delete')}</Button>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700">{a.body}</p>
            </li>
          ))}
        </ul>
        {(q.data?.pagination?.hasMore || page > 1) && (
          <Pagination className="mt-4" page={page} hasPrev={page > 1} hasNext={Boolean(q.data?.pagination?.hasMore)} onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)}
            labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }} />
        )}
      </QueryState>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('announcements.createTitle')} description={t('announcements.createDescription')} closeLabel={tc('close')} size="lg">
          {open && <CreateForm onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(del)}
        onOpenChange={(o) => !o && setDel(null)}
        title={t('announcements.deleteTitle')}
        description={t('announcements.deleteBody', { title: del?.title ?? '' })}
        confirmLabel={t('announcements.delete')}
        danger
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => { if (del) remove.mutate(del.id, { onSuccess: () => { setDel(null); toast({ title: t('announcements.deleted'), tone: 'success' }); } }); }}
      />
    </>
  );
}

const schema = z.object({
  title: z.string().trim().min(3, 'titleShort').max(200, 'tooLong'),
  body: z.string().trim().min(1, 'required').max(4000, 'tooLong'),
  audienceRoles: z.array(z.string()),
  expiresAt: z.string().refine((v) => v === '' || new Date(v).getTime() > Date.now(), 'expiryPast'),
});
type Values = z.infer<typeof schema>;

function CreateForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('workHr');
  const tc = useTranslations('common');
  const tr = useTranslations('roles');
  const fe = useFormErrors('workHr');
  const { toast } = useToast();
  const create = useCreateAnnouncement();
  const { register, control, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { title: '', body: '', audienceRoles: [], expiresAt: '' } });
  const submit = handleSubmit(async (v) => {
    try { await create.mutateAsync({ title: v.title, body: v.body, audienceRoles: v.audienceRoles, ...(v.expiresAt ? { expiresAt: new Date(v.expiresAt).toISOString() } : {}) }); } catch { return; } // the error is shown by <MutationAlert/>
    toast({ title: t('announcements.published'), tone: 'success' });
    onDone();
  });
  const e = formState.errors;
  return (
    <form onSubmit={(ev) => void submit(ev)} noValidate className="space-y-3">
      <FormField label={t('announcements.titleField')} required error={fe(e.title)}><Input {...register('title')} maxLength={200} /></FormField>
      <FormField label={t('announcements.bodyField')} required error={fe(e.body)}><Textarea rows={5} {...register('body')} maxLength={4000} /></FormField>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">{t('announcements.audience')}</legend>
        <p className="mb-2 text-xs text-muted">{t('announcements.audienceHint')}</p>
        <Controller control={control} name="audienceRoles" render={({ field }) => (
          <div className="grid gap-x-4 sm:grid-cols-2">
            {AUDIENCE.map((r) => (
              <Checkbox key={r} label={tr.has(r as never) ? tr(r as never) : r} checked={field.value.includes(r)} onCheckedChange={(c) => field.onChange(c === true ? [...field.value, r] : field.value.filter((x) => x !== r))} />
            ))}
          </div>
        )} />
      </fieldset>
      <FormField label={t('announcements.expires')} hint={t('announcements.expiresHint')} error={fe(e.expiresAt)}><Input type="datetime-local" {...register('expiresAt')} /></FormField>
      <p className="text-xs text-muted">{t('announcements.notifyNote')}</p>
      <MutationAlert error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>{tc('cancel')}</Button>
        <Button type="submit" loading={create.isPending}>{t('announcements.publish')}</Button>
      </div>
    </form>
  );
}
