'use client';
import * as React from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Checkbox, ErrorState, FormField, Input, PageHeader, Panel, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useFieldError } from '@/hooks/use-field-error';
import { ApiError } from '@/lib/api/client';
import { useCreateSop, useCreateVersion, useSopDoc, useSopVersion, useSubmitVersion, useUpdateVersion } from './api';
import { AUDIENCE_ROLES, SOP_CATEGORIES } from './categories';
import { SafeMarkdown } from './markdown';

const schema = z.object({
  category: z.string().min(1, 'required'),
  title: z.string().trim().min(3, 'required').max(200, 'tooLong'),
  summary: z.string().max(1000, 'tooLong').optional(),
  isMandatory: z.boolean(),
  audienceRoles: z.array(z.string()),
  tags: z.string().max(400, 'tooLong').optional(),
  body: z.string().trim().min(1, 'required').max(200000, 'tooLong'),
  changeSummary: z.string().trim().max(1000, 'tooLong').optional(),
  effectiveDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'required').optional(),
});
type Values = z.infer<typeof schema>;

export function NewSopPage() {
  return (
    <RequirePermission permission="sop:create">
      <EditorForm mode="new" />
    </RequirePermission>
  );
}

/** /sop/[id]/edit            -> new version (prefilled from the effective version)
 *  /sop/[id]/edit?version=ID -> edit an existing DRAFT/REJECTED version */
export function EditSopPage() {
  const { id } = useParams<{ id: string }>();
  const versionId = useSearchParams().get('version');
  return (
    <RequirePermission permission="sop:create">
      <EditLoader docId={id} versionId={versionId} />
    </RequirePermission>
  );
}

function EditLoader({ docId, versionId }: { docId: string; versionId: string | null }) {
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const doc = useSopDoc(docId);
  const version = useSopVersion(versionId);
  const pending = doc.isPending || (versionId ? version.isPending : false);
  if (pending) return <div role="status" aria-busy="true" aria-label={tc('loading')}><Skeleton className="h-96 rounded-lg" /></div>;
  const err = doc.error ?? version.error;
  if (doc.isError || (versionId && version.isError)) return <ErrorState description={apiErr(err).message} onRetry={() => { void doc.refetch(); void version.refetch(); }} retryLabel={tc('retry')} />;
  const base = versionId ? version.data! : doc.data!.effectiveVersion;
  return (
    <EditorForm
      mode={versionId ? 'edit' : 'version'}
      docId={docId}
      versionId={versionId ?? undefined}
      initial={{
        category: doc.data!.category, title: base?.title ?? doc.data!.title, summary: doc.data!.summary ?? '', isMandatory: doc.data!.isMandatory,
        audienceRoles: doc.data!.audienceRoles, tags: doc.data!.tags.join(', '), body: base?.body ?? '',
        changeSummary: versionId ? (version.data!.changeSummary ?? '') : '', effectiveDate: base && versionId ? (base.effectiveDate ?? '') : '',
      }}
      status={versionId ? version.data!.status : undefined}
    />
  );
}

export function EditorForm({ mode, docId, versionId, initial, status }: { mode: 'new' | 'version' | 'edit'; docId?: string; versionId?: string; initial?: Partial<Values>; status?: string }) {
  const t = useTranslations('sop.editor');
  const tc = useTranslations('common');
  const tcat = useTranslations('sop.categories');
  const tr = useTranslations('roles');
  const router = useRouter();
  const { toast } = useToast();
  const apiErr = useApiErrorMessage();
  const fe = useFieldError();
  const createSop = useCreateSop();
  const createVersion = useCreateVersion(docId ?? '');
  const updateVersion = useUpdateVersion(versionId ?? '');
  const submit = useSubmitVersion();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { category: '', title: '', summary: '', isMandatory: true, audienceRoles: ['SALES_MANAGER', 'SALES_EXECUTIVE'], tags: '', body: '', changeSummary: '', effectiveDate: '', ...initial },
  });
  const errs = form.formState.errors;
  const bodyValue = useWatch({ control: form.control, name: 'body' });
  const busy = createSop.isPending || createVersion.isPending || updateVersion.isPending || submit.isPending;
  const locked = status !== undefined && !['DRAFT', 'REJECTED'].includes(status);

  const run = async (v: Values, andSubmit: boolean) => {
    setError(null);
    if (mode !== 'new' && !(v.changeSummary ?? '').trim()) {
      form.setError('changeSummary', { message: 'required' });
      return;
    }
    try {
      let vid = versionId;
      let did = docId;
      const common = { body: v.body, changeSummary: v.changeSummary?.trim() || undefined, effectiveDate: v.effectiveDate || undefined, title: v.title };
      if (mode === 'new') {
        const r = await createSop.mutateAsync({ ...common, category: v.category, summary: v.summary?.trim() || undefined, isMandatory: v.isMandatory, audienceRoles: v.audienceRoles, tags: (v.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean), attachmentFileIds: [] });
        vid = r.versionId;
        did = r.id;
      } else if (mode === 'version') {
        vid = (await createVersion.mutateAsync({ ...common, changeSummary: v.changeSummary!.trim(), attachmentFileIds: [] })).id;
      } else {
        await updateVersion.mutateAsync(common);
      }
      if (andSubmit && vid) await submit.mutateAsync(vid);
      toast({ tone: 'success', title: andSubmit ? t('submitted') : t('saved') });
      router.push(`/sop/${did}`);
    } catch (e) {
      if (e instanceof ApiError) for (const [k, m] of Object.entries(e.fieldErrors)) if (k in v) form.setError(k as keyof Values, { message: m });
      setError(apiErr(e).message);
    }
  };

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={mode === 'new' ? t('newTitle') : mode === 'version' ? t('versionTitle') : t('editTitle')} description={t('description')} />
      {locked && <Alert tone="warning" className="mb-4">{t('locked')}</Alert>}
      {error && <Alert tone="danger" className="mb-4" live>{error}</Alert>}
      <form noValidate onSubmit={form.handleSubmit((v) => run(v, false))} className="stagger space-y-6">
        {mode === 'new' && (
          <Panel accent="gold" title={t('about')}>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label={t('category')} error={fe(errs.category)} required>
                <Select {...form.register('category')}>
                  <option value="">{t('chooseCategory')}</option>
                  {SOP_CATEGORIES.map((c) => <option key={c} value={c}>{tcat(c)}</option>)}
                </Select>
              </FormField>
              <FormField label={t('titleField')} error={fe(errs.title)} required><Input {...form.register('title')} /></FormField>
              <FormField className="md:col-span-2" label={t('summary')} error={fe(errs.summary)}><Textarea rows={2} {...form.register('summary')} /></FormField>
              <FormField label={t('tags')} hint={t('tagsHint')} error={fe(errs.tags)}><Input {...form.register('tags')} /></FormField>
              <div>
                <Controller control={form.control} name="isMandatory" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} label={t('mandatory')} description={t('mandatoryHint')} />} />
                <fieldset className="mt-3">
                  <legend className="text-sm font-medium text-ink">{t('audience')}</legend>
                  <p className="mb-1 text-[0.8125rem] text-muted">{t('audienceHint')}</p>
                  <Controller control={form.control} name="audienceRoles" render={({ field }) => (
                    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                      {AUDIENCE_ROLES.map((r) => (
                        <Checkbox key={r} label={tr(r)} checked={field.value.includes(r)} onCheckedChange={(c) => field.onChange(c === true ? [...field.value, r] : field.value.filter((x) => x !== r))} />
                      ))}
                    </div>
                  )} />
                </fieldset>
              </div>
            </div>
          </Panel>
        )}
        <Panel accent="blue" title={t('content')} description={t('contentHint')}>
          {mode !== 'new' && <FormField className="mb-4" label={t('titleField')} error={fe(errs.title)} required><Input {...form.register('title')} /></FormField>}
          <Tabs defaultValue="write">
            <TabsList aria-label={t('contentTabs')}>
              <TabsTrigger value="write">{t('write')}</TabsTrigger>
              <TabsTrigger value="preview">{t('preview')}</TabsTrigger>
            </TabsList>
            <TabsContent value="write">
              <FormField label={t('body')} error={fe(errs.body)} required hint={t('bodyHint')}><Textarea rows={16} className="font-mono text-[0.8125rem]" {...form.register('body')} /></FormField>
            </TabsContent>
            <TabsContent value="preview">
              <div className="min-h-40 rounded-md border border-line p-4">
                {bodyValue.trim() ? <SafeMarkdown source={bodyValue} /> : <p className="text-sm text-muted">{t('previewEmpty')}</p>}
              </div>
            </TabsContent>
          </Tabs>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FormField label={t('changeSummary')} hint={t('changeSummaryHint')} error={fe(errs.changeSummary)} required={mode !== 'new'}><Input {...form.register('changeSummary')} /></FormField>
            <FormField label={t('effectiveDate')} hint={t('effectiveDateHint')} error={fe(errs.effectiveDate)}><Input type="date" {...form.register('effectiveDate')} /></FormField>
          </div>
        </Panel>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={() => router.back()}>{tc('cancel')}</Button>
          <Button type="submit" variant="secondary" loading={busy} loadingLabel={tc('saving')} disabled={locked}>{t('saveDraft')}</Button>
          <Button type="button" className="glow-gold sheen" loading={busy} loadingLabel={tc('saving')} disabled={locked} onClick={form.handleSubmit((v) => run(v, true))}>{t('saveSubmit')}</Button>
        </div>
      </form>
    </>
  );
}
