'use client';
import { useTranslations } from 'next-intl';
import { Alert } from '@salesos/ui';
import type { SurveyResult } from './api';

/** Aggregated results only. Below the anonymity floor the server returns no numbers and we say why. */
export function ResultsView({ result }: { result: SurveyResult }) {
  const t = useTranslations('engagement');
  return (
    <section className="rounded-lg border border-line p-4" aria-label={result.title}>
      <h3 className="font-semibold text-ink">{result.title}</h3>
      <p className="text-sm text-muted">{t('results.responses', { count: result.responseCount })}</p>
      {result.suppressed || !result.questions ? (
        <Alert tone="info" className="mt-3" live={false}>{t('results.suppressed', { min: result.minResponses })}</Alert>
      ) : (
        <ul className="mt-3 space-y-3">
          {result.questions.map((q) => (
            <li key={q.questionId}>
              <p className="text-sm font-medium text-ink">{q.text}</p>
              <p className="text-sm text-ink-600">{t('results.average', { value: q.average ?? 0 })}</p>
              <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-ivory-200" role="img" aria-label={t('results.distribution', { text: [1, 2, 3, 4, 5].map((n) => `${n}: ${q.distribution[String(n)] ?? 0}`).join(', ') })}>
                {[1, 2, 3, 4, 5].map((n) => <span key={n} className="bg-blue-500/80" style={{ width: `${((q.distribution[String(n)] ?? 0) / Math.max(1, q.responses)) * 100}%`, opacity: 0.35 + n * 0.13 }} />)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
