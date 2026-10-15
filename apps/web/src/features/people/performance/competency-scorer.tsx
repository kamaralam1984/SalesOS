'use client';
import { useTranslations } from 'next-intl';
import type { Competency } from './api';

/** 1-5 scoring for every JD competency; behavioural indicators are shown as help text. */
export function CompetencyScorer({ competencies, value, onChange, disabled }: { competencies: Competency[]; value: Record<string, number>; onChange: (v: Record<string, number>) => void; disabled?: boolean }) {
  const t = useTranslations('performance');
  return (
    <div className="space-y-3">
      {competencies.filter((c) => c.isActive).map((c) => (
        <fieldset key={c.key} className="rounded-md border border-line p-3" disabled={disabled}>
          <legend className="px-1 text-sm font-medium text-ink">{c.name}</legend>
          {c.description && <p className="text-xs text-muted">{c.description}</p>}
          <div role="radiogroup" aria-label={c.name} className="mt-2 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-medium focus-within:outline-2 focus-within:outline-focus ${value[c.key] === n ? 'border-gold-500 bg-gold-50 text-gold-700' : 'border-line-strong text-ink'}`}>
                <input type="radio" className="sr-only" name={`score-${c.key}`} value={n} checked={value[c.key] === n} onChange={() => onChange({ ...value, [c.key]: n })} />
                <span aria-hidden="true">{n}</span>
                <span className="sr-only">{t('review.scoreOption', { competency: c.name, n })}</span>
              </label>
            ))}
          </div>
          {Object.keys(c.indicators).length > 0 && (
            <details className="mt-2 text-xs text-muted">
              <summary className="cursor-pointer">{t('review.indicators')}</summary>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(c.indicators).sort(([a], [b]) => Number(a) - Number(b)).map(([lvl, text]) => (
                  <li key={lvl}><strong className="text-ink">{lvl}:</strong> {text}</li>
                ))}
              </ul>
            </details>
          )}
        </fieldset>
      ))}
    </div>
  );
}
