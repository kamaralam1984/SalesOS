'use client';
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bookmark, RotateCcw, Trash2 } from 'lucide-react';
import { Button, DatePicker, Input, Popover, PopoverContent, PopoverTrigger, Select, useToast } from '@salesos/ui';
import { type AnalyticsQuery, useDeleteSavedFilter, useFilterOptions, useSaveFilter, useSavedFilters } from '@/lib/api/hooks/analytics';

type PeriodChoice = 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM';
const KEYS = ['period', 'from', 'to', 'teamId', 'programId', 'sourceId', 'ownerId'] as const;

/** Filter state lives in the URL (shareable, back-button safe). The server intersects every filter with the caller's scope. */
export function useAnalyticsFilters(defaults: Partial<AnalyticsQuery> = {}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? undefined])) as Record<(typeof KEYS)[number], string | undefined>;
  const choice: PeriodChoice = raw.period ? (raw.period as PeriodChoice) : raw.from ? 'CUSTOM' : ((defaults.period as PeriodChoice | undefined) ?? 'MONTH');
  const query: AnalyticsQuery = {
    ...(choice === 'CUSTOM' ? { from: raw.from, to: raw.to } : { period: choice, to: raw.to }),
    teamId: raw.teamId,
    programId: raw.programId,
    sourceId: raw.sourceId,
    ownerId: raw.ownerId,
  };
  const replace = React.useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [sp, router, pathname],
  );
  const activeCount = (['teamId', 'programId', 'sourceId', 'ownerId'] as const).filter((k) => raw[k]).length + (raw.period || raw.from || raw.to ? 1 : 0);
  return { query, raw, choice, replace, reset: () => replace(Object.fromEntries(KEYS.map((k) => [k, undefined]))), activeCount };
}

export function AnalyticsFilterBar({ filters, target, show = { team: true, program: true, source: true, owner: true } }: { filters: ReturnType<typeof useAnalyticsFilters>; target: string; show?: { team?: boolean; program?: boolean; source?: boolean; owner?: boolean } }) {
  const t = useTranslations('analytics.filters');
  const opts = useFilterOptions();
  const { raw, choice, replace, reset, activeCount, query } = filters;
  const id = React.useId();
  const o = opts.data;
  return (
    <div role="search" aria-label={t('label')} className="mb-5 rounded-lg border border-line bg-surface p-3 shadow-xs">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <label className="block text-[0.8125rem] font-medium text-ink-700">
          {t('period')}
          <Select value={choice} onChange={(e) => replace({ period: e.target.value === 'CUSTOM' ? undefined : e.target.value, from: e.target.value === 'CUSTOM' ? raw.from ?? raw.to : undefined })} className="mt-1" aria-label={t('period')}>
            <option value="WEEK">{t('week')}</option>
            <option value="MONTH">{t('month')}</option>
            <option value="QUARTER">{t('quarter')}</option>
            <option value="YEAR">{t('year')}</option>
            <option value="CUSTOM">{t('custom')}</option>
          </Select>
        </label>
        {choice === 'CUSTOM' ? (
          <>
            <label className="block text-[0.8125rem] font-medium text-ink-700">
              {t('from')}
              <DatePicker className="mt-1" value={raw.from ?? ''} onValueChange={(v) => replace({ from: v || undefined })} aria-label={t('from')} />
            </label>
            <label className="block text-[0.8125rem] font-medium text-ink-700">
              {t('to')}
              <DatePicker className="mt-1" value={raw.to ?? ''} onValueChange={(v) => replace({ to: v || undefined })} aria-label={t('to')} />
            </label>
          </>
        ) : (
          <label className="block text-[0.8125rem] font-medium text-ink-700">
            {t('asOf')}
            <DatePicker className="mt-1" value={raw.to ?? ''} onValueChange={(v) => replace({ to: v || undefined })} aria-label={t('asOf')} />
          </label>
        )}
        {show.team !== false && (
          <FilterSelect label={t('team')} all={t('allTeams')} value={raw.teamId} options={o?.teams} onChange={(v) => replace({ teamId: v })} />
        )}
        {show.program !== false && (
          <FilterSelect label={t('program')} all={t('allPrograms')} value={raw.programId} options={o?.programs} onChange={(v) => replace({ programId: v })} />
        )}
        {show.source !== false && (
          <FilterSelect label={t('source')} all={t('allSources')} value={raw.sourceId} options={o?.sources} onChange={(v) => replace({ sourceId: v })} />
        )}
        {show.owner !== false && o && o.owners.length > 0 && (
          <FilterSelect label={t('owner')} all={t('allOwners')} value={raw.ownerId} options={o.owners} onChange={(v) => replace({ ownerId: v })} />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" id={id}>
        <SavedFilters target={target} current={query} onApply={(f) => replace({ period: f.period, from: f.from, to: f.to, teamId: f.teamId, programId: f.programId, sourceId: f.sourceId, ownerId: f.ownerId })} />
        <Button variant="ghost" size="sm" onClick={reset} disabled={activeCount === 0} leadingIcon={<RotateCcw className="size-4" aria-hidden="true" />}>
          {t('reset')}
        </Button>
        <p className="text-xs text-muted" role="note">
          {t('scopeNote')}
        </p>
      </div>
    </div>
  );
}

function FilterSelect({ label, all, value, options, onChange }: { label: string; all: string; value: string | undefined; options: Array<{ id: string; name: string }> | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <label className="block text-[0.8125rem] font-medium text-ink-700">
      {label}
      <Select className="mt-1" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} aria-label={label} disabled={!options}>
        <option value="">{all}</option>
        {(options ?? []).map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function SavedFilters({ target, current, onApply }: { target: string; current: AnalyticsQuery; onApply: (f: AnalyticsQuery) => void }) {
  const t = useTranslations('analytics.filters');
  const listQ = useSavedFilters(target);
  const saved = Array.isArray(listQ.data) ? listQ.data : [];
  const save = useSaveFilter();
  const del = useDeleteSavedFilter();
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" leadingIcon={<Bookmark className="size-4" aria-hidden="true" />}>
          {t('saved')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]">
        <p className="text-sm font-semibold text-ink">{t('savedTitle')}</p>
        <ul className="mt-2 max-h-48 space-y-1 overflow-auto" aria-label={t('savedTitle')}>
          {saved.length === 0 && <li className="text-[0.8125rem] text-muted">{t('noSaved')}</li>}
          {saved.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2">
              <button type="button" className="min-h-9 flex-1 truncate rounded px-2 text-left text-sm hover:bg-ivory-200" onClick={() => { onApply(s.filters); setOpen(false); }}>
                {s.name}
              </button>
              <button type="button" aria-label={t('deleteSaved', { name: s.name })} className="inline-flex size-9 items-center justify-center rounded text-ink-500 hover:bg-ivory-200 hover:text-red-700" onClick={() => del.mutate(s.id)}>
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            save.mutate(
              { name: name.trim(), target, filters: current },
              { onSuccess: () => { setName(''); toast({ title: t('savedOk'), tone: 'success' }); }, onError: () => toast({ title: t('saveFailed'), tone: 'danger' }) },
            );
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('saveName')} aria-label={t('saveName')} />
          <Button type="submit" size="sm" loading={save.isPending} disabled={!name.trim()}>
            {t('save')}
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted">{t('savedNote')}</p>
      </PopoverContent>
    </Popover>
  );
}
