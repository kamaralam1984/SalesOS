'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, Search, X } from 'lucide-react';
import { Button, FormField, Input } from '@salesos/ui';
import { useLeads } from '@/lib/api';
import { useDebounced } from './shared';

export interface PickedLead { id: string; name: string }

/** Search-as-you-type learner / prospect picker backed by the CRM lead search (server-scoped to what the caller may see). */
export function LeadPicker({ value, onChange, label, hint, required, error }: { value: PickedLead | null; onChange: (l: PickedLead | null) => void; label: string; hint?: string; required?: boolean; error?: string }) {
  const t = useTranslations('cx.picker');
  const [text, setText] = React.useState('');
  const q = useDebounced(text.trim());
  const query = useLeads({ q: q.length >= 2 ? q : undefined, limit: 6 });
  const enabled = q.length >= 2;
  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">{label}{required && <span aria-hidden="true" className="ml-0.5 text-red-700">*</span>}</span>
        <div className="flex items-center justify-between gap-2 rounded-md border border-line-strong bg-ivory-100 px-3 py-2">
          <span className="inline-flex items-center gap-2 text-sm text-ink"><Check className="size-4 text-green-700" aria-hidden="true" />{value.name}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} aria-label={t('clear')}><X className="size-4" aria-hidden="true" /></Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <FormField label={label} hint={hint ?? t('hint')} required={required} error={error}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-500" aria-hidden="true" />
          <Input className="pl-9" type="search" value={text} placeholder={t('placeholder')} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </div>
      </FormField>
      {enabled && (
        <div role="listbox" aria-label={t('results')} className="overflow-hidden rounded-md border border-line bg-surface">
          {query.isPending ? <p className="px-3 py-2 text-sm text-muted">{t('searching')}</p> : query.isError ? <p className="px-3 py-2 text-sm text-red-700">{t('error')}</p> : query.data.items.length === 0 ? <p className="px-3 py-2 text-sm text-muted">{t('none')}</p> : (
            query.data.items.map((l) => (
              <button key={l.id} type="button" role="option" aria-selected="false" className="flex w-full min-h-11 items-center justify-between gap-3 border-b border-line/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-ivory-100 focus-visible:bg-ivory-100" onClick={() => { onChange({ id: l.id, name: l.fullName }); setText(''); }}>
                <span className="font-medium text-ink">{l.fullName}</span>
                <span className="text-xs text-muted">{l.program?.name ?? l.status}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
