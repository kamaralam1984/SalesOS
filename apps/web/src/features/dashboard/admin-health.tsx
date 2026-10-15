'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Alert, Card, PageHeader, Panel } from '@salesos/ui';
import { useSystemHealth } from '@/lib/api/hooks/analytics';
import { formatTime } from './format';
import { QueryBoundary, Section } from './query-boundary';

/** Administrator: operational health only. No leads, revenue, people or customer data is requested or shown. */
export function AdminHealth() {
  const t = useTranslations('analytics.admin');
  const lc = useLocale();
  const q = useSystemHealth();
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <Alert tone="info" className="mb-5">{t('noBusinessData')}</Alert>
      <QueryBoundary q={q}>
        {(h) => (
          <div>
            <Section title={t('services')}>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(h.services).map(([name, s]) => (
                  <Card key={name} accent={s.ok ? 'none' : 'red'}>
                    <p className="flex items-center gap-2 font-medium text-ink">{s.ok ? <CheckCircle2 aria-hidden="true" className="size-4 text-green-700" /> : <XCircle aria-hidden="true" className="size-4 text-red-700" />}{t(`service.${name}` as 'service.database')}<span className="sr-only"> {s.ok ? t('up') : t('down')}</span></p>
                    <p className="mt-1 text-sm text-muted">{s.ok ? t('latency', { ms: s.latencyMs }) : (s.error ?? t('down'))}</p>
                  </Card>
                ))}
              </div>
            </Section>
            <Section title={t('queues')} description={t('queuesHint')}>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {Object.entries(h.queues).map(([name, qd]) => (
                  <Panel key={name} title={t(`queue.${name}` as 'queue.outbox')} headingLevel={3}>
                    {Object.keys(qd.byStatus).length === 0 ? <p className="text-sm text-muted">{t('empty')}</p> : (
                      <ul className="space-y-1 text-sm">{Object.entries(qd.byStatus).map(([s, n]) => <li key={s} className="flex justify-between"><span>{s}</span><span className="tabular font-medium">{n}</span></li>)}</ul>
                    )}
                  </Panel>
                ))}
              </div>
            </Section>
            <Section title={t('dataQuality')}>
              <Card>
                {h.dataQuality ? (
                  <p className="text-sm text-ink-700">{t('lastReconciliation', { time: formatTime(h.dataQuality.lastReconciliationAt, lc), passed: h.dataQuality.passed, total: h.dataQuality.checks, failed: h.dataQuality.failed })}</p>
                ) : <p className="text-sm text-muted">{t('noReconciliation')}</p>}
              </Card>
            </Section>
            <Section title={t('process')}>
              <p className="text-sm text-muted">{t('processLine', { env: h.process.env, node: h.process.node, uptime: Math.round(h.process.uptimeSeconds / 60), rss: h.process.rssMb })}</p>
              <p className="mt-1 text-xs text-muted">{t('generated', { time: formatTime(h.generatedAt, lc) })}</p>
            </Section>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
