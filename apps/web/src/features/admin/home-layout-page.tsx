'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Bell, CalendarCheck, GraduationCap, LayoutGrid, PhoneCall, Phone, Target, type LucideIcon } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, PageHeader, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { useHomeLayoutOverview, useResetHomeLayout, useSaveHomeLayout, type RoleHomeLayout } from '@/lib/api/hooks/home-layout';
import { HOME_WIDGET_SIZES, SIZE_ZOOM, type HomeWidgetEntry, type HomeWidgetId, type HomeWidgetSize } from '@/features/mobile/home/widgets';

const ICON: Record<HomeWidgetId, LucideIcon> = { stats: LayoutGrid, attendance: CalendarCheck, goal: Target, onboarding: GraduationCap, followups: Bell, quickActions: PhoneCall, workspace: Phone };
const HEIGHT: Record<HomeWidgetId, string> = { stats: 'h-12', attendance: 'h-20', goal: 'h-24', onboarding: 'h-20', followups: 'h-24', quickActions: 'h-16', workspace: 'h-20' };

/** Move the widget at `index` by `delta` places (pure; out-of-range moves are ignored). */
export function moveWidget(list: readonly HomeWidgetEntry[], index: number, delta: -1 | 1): HomeWidgetEntry[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return next;
}

export function HomeLayoutPage() {
  const t = useTranslations('homeLayout');
  return (
    <RequirePermission permission="home-layout:manage">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('homeLayout');
  const q = useHomeLayoutOverview();
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) {
    return (
      <Alert tone="danger">
        {t('loadError')} <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>{t('retry')}</Button>
      </Alert>
    );
  }
  const roles = q.data.roles;
  return (
    <Tabs defaultValue="edit">
      <TabsList aria-label={t('title')}>
        <TabsTrigger value="edit">{t('editTab')}</TabsTrigger>
        <TabsTrigger value="all">{t('allTab')}</TabsTrigger>
      </TabsList>
      <TabsContent value="edit"><Editor roles={roles} /></TabsContent>
      <TabsContent value="all">
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => (
            <div key={r.role} className="flex flex-col items-center gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">{t(`roles.${r.role}` as never)} <Badge tone={r.customised ? 'gold' : 'neutral'}>{r.customised ? t('customised') : t('isDefault')}</Badge></p>
              <PhonePreview widgets={r.widgets} applicable={r.applicable} />
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">{t('previewNote')}</p>
      </TabsContent>
    </Tabs>
  );
}

function Editor({ roles }: { roles: RoleHomeLayout[] }) {
  const [role, setRole] = React.useState(roles[0]?.role ?? '');
  const current = roles.find((r) => r.role === role);
  if (!current) return null;
  // a fresh editor (empty draft) per role and per saved layout, so switching roles or saving never needs state syncing
  return <RoleEditor key={`${role}:${JSON.stringify(current.widgets)}`} roles={roles} role={role} setRole={setRole} current={current} />;
}

function RoleEditor({ roles, role, setRole, current }: { roles: RoleHomeLayout[]; role: string; setRole: (r: string) => void; current: RoleHomeLayout }) {
  const t = useTranslations('homeLayout');
  const { toast } = useToast();
  const save = useSaveHomeLayout();
  const reset = useResetHomeLayout();
  const [draft, setDraft] = React.useState<HomeWidgetEntry[]>(current.widgets);
  const dirty = JSON.stringify(draft) !== JSON.stringify(current.widgets);
  const patch = (id: HomeWidgetId, p: Partial<HomeWidgetEntry>) => setDraft((d) => d.map((w) => (w.id === id ? { ...w, ...p } : w)));
  const onSave = () => save.mutate({ role, widgets: draft }, { onSuccess: () => toast({ tone: 'success', title: t('saved') }) });
  const onReset = () => reset.mutate(role, { onSuccess: () => toast({ tone: 'success', title: t('resetDone') }) });
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section aria-label={t('editTab')} className="space-y-4">
        <label className="block max-w-sm text-sm font-medium text-ink">
          {t('role')}
          <Select className="mt-1" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => <option key={r.role} value={r.role}>{t(`roles.${r.role}` as never)}{r.customised ? ` · ${t('customised')}` : ''}</option>)}
          </Select>
        </label>
        <ol className="space-y-2">
          {draft.map((w, i) => {
            const Icon = ICON[w.id];
            const used = current.applicable.includes(w.id);
            return (
              <li key={w.id} className="rounded-lg border border-line bg-surface p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <Icon aria-hidden="true" className="size-5 shrink-0 text-gold-700" />
                  <span className="min-w-0 flex-1 font-medium text-ink">{t(`widget.${w.id}` as never)}</span>
                  <Button size="sm" variant="ghost" className="min-h-11 min-w-11" aria-label={`${t('up')}: ${t(`widget.${w.id}` as never)}`} disabled={i === 0} onClick={() => setDraft((d) => moveWidget(d, i, -1))}><ArrowUp aria-hidden="true" className="size-4" /></Button>
                  <Button size="sm" variant="ghost" className="min-h-11 min-w-11" aria-label={`${t('down')}: ${t(`widget.${w.id}` as never)}`} disabled={i === draft.length - 1} onClick={() => setDraft((d) => moveWidget(d, i, 1))}><ArrowDown aria-hidden="true" className="size-4" /></Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 pl-8">
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
                    <Checkbox checked={w.visible} onCheckedChange={(v) => patch(w.id, { visible: v === true })} aria-label={`${t('visible')}: ${t(`widget.${w.id}` as never)}`} />
                    {t('visible')}
                  </label>
                  <div role="group" aria-label={`${t('size')}: ${t(`widget.${w.id}` as never)}`} className="inline-flex overflow-hidden rounded-md border border-line">
                    {HOME_WIDGET_SIZES.map((s) => (
                      <button key={s} type="button" aria-pressed={w.size === s} onClick={() => patch(w.id, { size: s as HomeWidgetSize })}
                        className={`min-h-11 min-w-11 px-3 text-sm font-medium ${w.size === s ? 'bg-gold-100 text-gold-700' : 'bg-surface text-muted hover:text-ink'}`}>
                        {t(`size${s}` as never)}
                      </button>
                    ))}
                  </div>
                </div>
                {!used && <p className="mt-2 pl-8 text-xs text-muted">{t('notUsed')}</p>}
              </li>
            );
          })}
        </ol>
        {dirty && <p role="status" className="text-sm text-gold-700">{t('unsaved')}</p>}
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={!dirty} loading={save.isPending} onClick={onSave}>{t('save')}</Button>
          <Button className="min-h-11" variant="secondary" disabled={!current.customised} loading={reset.isPending} onClick={onReset}>{t('reset')}</Button>
        </div>
      </section>
      <aside aria-label={t('previewTitle')} className="flex flex-col items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{t('previewTitle')}</h2>
        <PhonePreview widgets={draft} applicable={current.applicable} />
        <p className="text-center text-xs text-muted">{t('previewNote')}</p>
      </aside>
    </div>
  );
}

/** A phone-shaped frame of placeholder blocks in the chosen order and size. Never shows real data. */
export function PhonePreview({ widgets, applicable }: { widgets: readonly HomeWidgetEntry[]; applicable: readonly HomeWidgetId[] }) {
  const t = useTranslations('homeLayout');
  const shown = widgets.filter((w) => w.visible && applicable.includes(w.id));
  return (
    <div className="w-64 rounded-[1.75rem] border-4 border-ink/80 bg-ivory-100 p-3 shadow-md" role="img" aria-label={shown.map((w) => `${t(`widget.${w.id}` as never)} (${t(`size${w.size}` as never)})`).join(', ')}>
      <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-ink/30" aria-hidden="true" />
      <div className="flex max-h-[34rem] flex-col gap-2 overflow-hidden" aria-hidden="true">
        {shown.map((w) => {
          const Icon = ICON[w.id];
          return (
            <div key={w.id} style={{ zoom: SIZE_ZOOM[w.size] }} className={`${HEIGHT[w.id]} rounded-xl border border-line bg-surface p-2`}>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink"><Icon className="size-3.5 text-gold-700" />{t(`widget.${w.id}` as never)}</p>
              <div className="mt-1.5 h-1.5 w-3/4 rounded-full bg-ivory-300" />
              <div className="mt-1 h-1.5 w-1/2 rounded-full bg-ivory-300" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
