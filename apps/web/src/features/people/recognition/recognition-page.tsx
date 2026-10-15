'use client';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Award, Plus, Sparkles } from 'lucide-react';
import { Badge, Button, Card, Dialog, DialogContent, FormField, Input, PageHeader, Pagination, Select, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { RequirePermission } from '@/features/auth/require-permission';
import { useTeamMemberOptions } from '../common/api';
import { useCompetencies } from '../performance/api';
import { MutationAlert, QueryState, useFormatDate, useFormErrors } from '../hub/shared';
import { useCreateProgram, useGrantRecognition, useMyRecognitions, usePrograms, useWall, type RecognitionItem } from './api';

export function RecognitionPage() {
  return (
    <RequirePermission permission="recognition:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('recognition');
  const { can } = useAuth();
  const [grant, setGrant] = React.useState(false);
  const [prog, setProg] = React.useState(false);
  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <>
            {can('recognition:create') && <Button variant="gold" leadingIcon={<Sparkles aria-hidden="true" />} onClick={() => setGrant(true)}>{t('grant')}</Button>}
            {can('recognition:create', 'org') && <Button variant="secondary" leadingIcon={<Plus aria-hidden="true" />} onClick={() => setProg(true)}>{t('newProgram')}</Button>}
          </>
        }
      />
      <Tabs defaultValue="wall">
        <TabsList aria-label={t('title')}>
          <TabsTrigger value="wall">{t('tabs.wall')}</TabsTrigger>
          <TabsTrigger value="mine">{t('tabs.mine')}</TabsTrigger>
          <TabsTrigger value="programs">{t('tabs.programs')}</TabsTrigger>
        </TabsList>
        <TabsContent value="wall"><Feed mode="wall" /></TabsContent>
        <TabsContent value="mine"><Feed mode="scoped" /></TabsContent>
        <TabsContent value="programs"><Programs /></TabsContent>
      </Tabs>
      <Dialog open={grant} onOpenChange={setGrant}>
        <DialogContent title={t('grantTitle')} description={t('grantDescription')} closeLabel={t('close')}>
          {grant && <GrantForm onDone={() => setGrant(false)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={prog} onOpenChange={setProg}>
        <DialogContent title={t('newProgram')} closeLabel={t('close')}>
          {prog && <ProgramForm onDone={() => setProg(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Feed({ mode }: { mode: 'wall' | 'scoped' }) {
  const t = useTranslations('recognition');
  const tc = useTranslations('common');
  const fmt = useFormatDate();
  const [page, setPage] = React.useState(1);
  const wall = useWall(page);
  const scoped = useMyRecognitions(page);
  const q = mode === 'wall' ? wall : scoped;
  return (
    <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={t(mode === 'wall' ? 'wallEmpty' : 'mineEmpty')} emptyDescription={t(mode === 'wall' ? 'wallEmptyBody' : 'mineEmptyBody')}>
      <ul className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t(mode === 'wall' ? 'tabs.wall' : 'tabs.mine')}>
        {(q.data?.items ?? []).map((r: RecognitionItem) => (
          <li key={r.id}>
            <Card accent="gold" className="hover-lift h-full">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gold-50 text-gold-700 glow-gold"><Award className="size-5" /></span>
                <div className="min-w-0">
                  <h2 className="font-display text-base font-semibold text-ink">{r.recipientName ?? '—'}</h2>
                  <p className="text-xs text-muted">{r.programName}{r.periodLabel ? ` · ${r.periodLabel}` : ''}</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-ink">{r.reason}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{fmt.date(r.createdAt)}</span>
                {r.grantedByName && <span>{t('by', { name: r.grantedByName })}</span>}
                {mode === 'scoped' && <Badge tone={r.isPublic ? 'green' : 'neutral'}>{t(r.isPublic ? 'onWall' : 'private')}</Badge>}
              </p>
            </Card>
          </li>
        ))}
      </ul>
      {(q.data?.pagination?.hasMore || page > 1) && (
        <Pagination
          className="mt-4"
          page={page}
          hasPrev={page > 1}
          hasNext={Boolean(q.data?.pagination?.hasMore)}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
          labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }}
        />
      )}
    </QueryState>
  );
}

function Programs() {
  const t = useTranslations('recognition');
  const q = usePrograms();
  return (
    <QueryState query={q} isEmpty={(q.data?.length ?? 0) === 0} emptyTitle={t('programsEmpty')} emptyDescription={t('programsEmptyBody')}>
      <ul className="stagger divide-y divide-line rounded-lg border border-line bg-surface">
        {(q.data ?? []).map((p) => (
          <li key={p.id} className="p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium text-ink">{p.name}</h2>
              <Badge tone="gold">{t(`kinds.${p.kind}` as never)}</Badge>
            </div>
            {p.description && <p className="text-sm text-muted">{p.description}</p>}
            {p.criteria && <p className="mt-1 text-sm text-muted"><span className="font-medium text-ink">{t('criteria')}: </span>{p.criteria}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">{t('humanDecision')}</p>
    </QueryState>
  );
}

const grantSchema = z.object({
  programId: z.string().min(1, 'required'),
  recipientId: z.string().min(1, 'required'),
  reason: z.string().trim().min(5, 'reasonShort').max(1000, 'tooLong'),
  periodLabel: z.string().max(40, 'tooLong').optional(),
  competencyKey: z.string().optional(),
  isPublic: z.boolean(),
});
type GrantValues = z.infer<typeof grantSchema>;

/** PURE: grant form -> POST body. */
export const buildGrantPayload = (v: GrantValues) => ({
  programId: v.programId,
  recipientId: v.recipientId,
  reason: v.reason.trim(),
  isPublic: v.isPublic,
  ...(v.periodLabel?.trim() ? { periodLabel: v.periodLabel.trim() } : {}),
  ...(v.competencyKey ? { competencyKey: v.competencyKey } : {}),
});

function GrantForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('recognition');
  const fe = useFormErrors('recognition');
  const { user, can } = useAuth();
  const { toast } = useToast();
  const programs = usePrograms();
  const people = useTeamMemberOptions();
  const comps = useCompetencies(can('reviews:view'));
  const grant = useGrantRecognition();
  const { register, handleSubmit, formState, setValue, control } = useForm<GrantValues>({
    resolver: zodResolver(grantSchema),
    defaultValues: { programId: '', recipientId: '', reason: '', periodLabel: '', competencyKey: '', isPublic: false },
  });
  const isPublic = useWatch({ control, name: 'isPublic' });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await grant.mutateAsync(buildGrantPayload(v));
      toast({ tone: 'success', title: t('granted') });
      onDone();
    } catch {
      /* shown below */
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label={t('grantTitle')}>
      <FormField label={t('program')} error={fe(formState.errors.programId)} required>
        <Select {...register('programId')}>
          <option value="">{t('choose')}</option>
          {(programs.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </FormField>
      <FormField label={t('recipient')} error={fe(formState.errors.recipientId)} required>
        <Select {...register('recipientId')}>
          <option value="">{t('choose')}</option>
          {(people.data ?? []).filter((p) => p.id !== user?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </FormField>
      <FormField label={t('reason')} error={fe(formState.errors.reason)} required><Textarea rows={3} {...register('reason')} /></FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('periodLabel')} hint={t('periodHint')}><Input {...register('periodLabel')} /></FormField>
        {can('reviews:view') && (
          <FormField label={t('competency')}>
            <Select {...register('competencyKey')}>
              <option value="">{t('none')}</option>
              {(comps.data ?? []).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </Select>
          </FormField>
        )}
      </div>
      <Switch label={t('shareOnWall')} description={t('shareHint')} checked={isPublic} onCheckedChange={(c) => setValue('isPublic', c)} />
      <MutationAlert error={grant.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>{t('cancel')}</Button>
        <Button type="submit" loading={grant.isPending}>{t('grantSave')}</Button>
      </div>
    </form>
  );
}

const programSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, 'keyFormat'),
  name: z.string().trim().min(2, 'required').max(120, 'tooLong'),
  kind: z.enum(['TOP_PERFORMER', 'CULTURE', 'MILESTONE', 'AWARD']),
  description: z.string().max(1000, 'tooLong').optional(),
  criteria: z.string().max(1000, 'tooLong').optional(),
});
type ProgramValues = z.infer<typeof programSchema>;

function ProgramForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('recognition');
  const fe = useFormErrors('recognition');
  const { toast } = useToast();
  const create = useCreateProgram();
  const { register, handleSubmit, formState } = useForm<ProgramValues>({ resolver: zodResolver(programSchema), defaultValues: { key: '', name: '', kind: 'AWARD', description: '', criteria: '' } });
  const onSubmit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync({ key: v.key, name: v.name, kind: v.kind, ...(v.description ? { description: v.description } : {}), ...(v.criteria ? { criteria: v.criteria } : {}) });
      toast({ tone: 'success', title: t('programSaved') });
      onDone();
    } catch {
      /* shown below */
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3" aria-label={t('newProgram')}>
      <FormField label={t('programName')} error={fe(formState.errors.name)} required><Input {...register('name')} /></FormField>
      <FormField label={t('programKey')} hint={t('programKeyHint')} error={fe(formState.errors.key)} required><Input {...register('key')} /></FormField>
      <FormField label={t('programKind')}>
        <Select {...register('kind')}>
          {(['TOP_PERFORMER', 'CULTURE', 'MILESTONE', 'AWARD'] as const).map((k) => <option key={k} value={k}>{t(`kinds.${k}` as never)}</option>)}
        </Select>
      </FormField>
      <FormField label={t('programDescription')}><Textarea rows={2} {...register('description')} /></FormField>
      <FormField label={t('criteria')} hint={t('criteriaHint')}><Textarea rows={2} {...register('criteria')} /></FormField>
      <MutationAlert error={create.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>{t('cancel')}</Button>
        <Button type="submit" loading={create.isPending}>{t('programSave')}</Button>
      </div>
    </form>
  );
}
