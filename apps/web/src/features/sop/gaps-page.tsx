'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ListChecks, Pencil, Plus } from 'lucide-react';
import { Alert, Badge, Button, DataTable, Dialog, DialogContent, FormField, Input, PageHeader, Pagination, Select, StatusBadge, Textarea, useToast, type Column } from '@salesos/ui';
import { Reveal } from '@/components/motion';
import { RequirePermission } from '@/features/auth/require-permission';
import { usePermission } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useFieldError } from '@/hooks/use-field-error';
import { useTeamMemberOptions } from '@/features/people/common/api';
import { useCreateGap, useGaps, useUpdateGap, type Gap, type GapKind, type GapStatus } from './api';
import { usePaginationLabels } from './shared';

const STATUSES: GapStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX'];
const KINDS: GapKind[] = ['PROCESS_GAP', 'AUTOMATION'];

export const createGapSchema = z.object({
  kind: z.enum(['PROCESS_GAP', 'AUTOMATION']),
  title: z.string().trim().min(3, 'required').max(200, 'tooLong'),
  description: z.string().max(4000, 'tooLong').optional(),
  ownerId: z.string().optional(),
  priority: z.coerce.number().int().min(1).max(5),
});
export const updateGapSchema = z
  .object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX']),
    resolution: z.string().max(4000, 'tooLong').optional(),
    ownerId: z.string().optional(),
    priority: z.coerce.number().int().min(1).max(5),
  })
  .refine((v) => v.status !== 'RESOLVED' || Boolean(v.resolution?.trim()), { path: ['resolution'], message: 'required' });

export function GapsPage() {
  return (
    <RequirePermission permission="sop:gaps:view">
      <GapsInner />
    </RequirePermission>
  );
}

const statusTone = { OPEN: 'warning', IN_PROGRESS: 'info', RESOLVED: 'success', WONT_FIX: 'neutral' } as const;

function GapsInner() {
  const t = useTranslations('sop.gaps');
  const tc = useTranslations('common');
  const labels = usePaginationLabels();
  const apiErr = useApiErrorMessage();
  const canManage = usePermission('sop:gaps:manage');
  const [status, setStatus] = React.useState('');
  const [kind, setKind] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Gap | null>(null);
  const q = useGaps({ page, limit: 20, status: status || undefined, kind: kind || undefined });

  const cols: Column<Gap>[] = [
    { id: 'title', header: t('titleCol'), primary: true, cell: (g) => (<div><div className="font-medium">{g.title}</div>{g.description && <div className="line-clamp-2 text-sm text-muted">{g.description}</div>}{g.resolution && <div className="mt-1 text-sm text-ink-700">{t('resolution')}: {g.resolution}</div>}</div>) },
    { id: 'kind', header: t('kind'), cell: (g) => <Badge tone={g.kind === 'AUTOMATION' ? 'blue' : 'neutral'}>{t(`kinds.${g.kind}`)}</Badge> },
    { id: 'status', header: t('status'), cell: (g) => <StatusBadge status={statusTone[g.status]}>{t(`statuses.${g.status}`)}</StatusBadge> },
    { id: 'priority', header: t('priority'), hideOnMobile: true, cell: (g) => `P${g.priority}` },
    { id: 'owner', header: t('owner'), hideOnMobile: true, cell: (g) => g.ownerName ?? '—' },
  ];

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        breadcrumbs={[{ label: t('library'), href: '/sop' }, { label: t('title') }]}
        breadcrumbLabel={tc('breadcrumb')}
        actions={canManage ? <Button leadingIcon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setCreating(true)}>{t('new')}</Button> : undefined}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <FormField label={t('status')} hideLabel><Select aria-label={t('status')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">{t('allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}</Select></FormField>
        <FormField label={t('kind')} hideLabel><Select aria-label={t('kind')} value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}><option value="">{t('allKinds')}</option>{KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}</Select></FormField>
      </div>
      <Reveal delay={0.08}>
      <DataTable
        caption={t('title')}
        columns={cols}
        rows={q.data?.items}
        loading={q.isPending}
        error={q.isError ? { message: apiErr(q.error).message, onRetry: () => q.refetch() } : null}
        getRowId={(g) => g.id}
        emptyTitle={status || kind ? t('noMatches') : t('empty')}
        emptyDescription={t('emptyHint')}
        loadingLabel={tc('loading')}
        actionsHeader={tc('actions')}
        rowActions={canManage ? (g) => <Button size="sm" variant="secondary" leadingIcon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditing(g)}>{tc('edit')}</Button> : undefined}
      />
      </Reveal>
      {q.data && q.data.items.length > 0 && <Pagination className="mt-4" page={page} hasNext={Boolean(q.data.pagination?.hasMore)} onPageChange={setPage} labels={labels} />}
      <Dialog open={creating} onOpenChange={setCreating}>{creating && <CreateBody onDone={() => setCreating(false)} />}</Dialog>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>{editing && <EditBody gap={editing} onDone={() => setEditing(null)} />}</Dialog>
    </>
  );
}

function CreateBody({ onDone }: { onDone: () => void }) {
  const t = useTranslations('sop.gaps');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const create = useCreateGap();
  const owners = useTeamMemberOptions();
  const [err, setErr] = React.useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(createGapSchema), defaultValues: { kind: 'PROCESS_GAP' as GapKind, title: '', description: '', ownerId: '', priority: 3 } });
  const e = form.formState.errors;
  return (
    <DialogContent title={t('new')} description={t('newHint')} closeLabel={tc('close')} footer={<><Button variant="secondary" onClick={onDone}>{tc('cancel')}</Button><Button type="submit" form="gap-create" loading={create.isPending} loadingLabel={tc('saving')}>{t('create')}</Button></>}>
      <form id="gap-create" noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => {
        setErr(null);
        try {
          await create.mutateAsync({ kind: v.kind, title: v.title, description: v.description?.trim() || undefined, ownerId: v.ownerId || undefined, priority: v.priority });
          toast({ tone: 'success', title: t('created') });
          onDone();
        } catch (x) { setErr(apiErr(x).message); }
      })}>
        {err && <Alert tone="danger" live>{err}</Alert>}
        <FormField label={t('kind')}><Select {...form.register('kind')}>{KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}</Select></FormField>
        <FormField label={t('titleCol')} error={fe(e.title)} required><Input {...form.register('title')} /></FormField>
        <FormField label={t('descriptionField')} error={fe(e.description)}><Textarea rows={3} {...form.register('description')} /></FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('owner')}><Select {...form.register('ownerId')}><option value="">{t('ownerSelf')}</option>{owners.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></FormField>
          <FormField label={t('priority')} hint={t('priorityHint')}><Select {...form.register('priority')}>{[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}</Select></FormField>
        </div>
      </form>
    </DialogContent>
  );
}

function EditBody({ gap, onDone }: { gap: Gap; onDone: () => void }) {
  const t = useTranslations('sop.gaps');
  const tc = useTranslations('common');
  const fe = useFieldError();
  const apiErr = useApiErrorMessage();
  const { toast } = useToast();
  const update = useUpdateGap(gap.id);
  const owners = useTeamMemberOptions();
  const [err, setErr] = React.useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(updateGapSchema), defaultValues: { status: gap.status, resolution: gap.resolution ?? '', ownerId: gap.ownerId ?? '', priority: gap.priority } });
  const e = form.formState.errors;
  const st = useWatch({ control: form.control, name: 'status' });
  return (
    <DialogContent title={t('edit')} description={gap.title} closeLabel={tc('close')} footer={<><Button variant="secondary" onClick={onDone}>{tc('cancel')}</Button><Button type="submit" form="gap-edit" loading={update.isPending} loadingLabel={tc('saving')} leadingIcon={<ListChecks className="size-4" aria-hidden="true" />}>{tc('save')}</Button></>}>
      <form id="gap-edit" noValidate className="space-y-4" onSubmit={form.handleSubmit(async (v) => {
        setErr(null);
        try {
          await update.mutateAsync({ status: v.status, resolution: v.resolution?.trim() || undefined, ownerId: v.ownerId || null, priority: v.priority });
          toast({ tone: 'success', title: t('updated') });
          onDone();
        } catch (x) { setErr(apiErr(x).message); }
      })}>
        {err && <Alert tone="danger" live>{err}</Alert>}
        <FormField label={t('status')}><Select {...form.register('status')}>{STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}</Select></FormField>
        <FormField label={t('resolution')} error={fe(e.resolution)} required={st === 'RESOLVED'} hint={t('resolutionHint')}><Textarea rows={3} {...form.register('resolution')} /></FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('owner')}><Select {...form.register('ownerId')}><option value="">{t('unassigned')}</option>{owners.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}{gap.ownerId && !owners.data?.some((o) => o.id === gap.ownerId) && <option value={gap.ownerId}>{gap.ownerName ?? gap.ownerId}</option>}</Select></FormField>
          <FormField label={t('priority')}><Select {...form.register('priority')}>{[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}</Select></FormField>
        </div>
      </form>
    </DialogContent>
  );
}
