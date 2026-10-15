'use client';
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import { Badge, Button, PageHeader } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState, useFormatDate } from '@/features/people/hub/shared';
import { useMyPayslips, usePayslip, type Payslip } from '@/lib/api/hooks/work-payroll';
import { formatMoney, formatMonth } from './money';
import { RunStatusBadge } from './shared';

export function PayslipsPage() {
  return (
    <RequirePermission permission="payroll:payslip:view">
      <React.Suspense fallback={null}>
        <Inner />
      </React.Suspense>
    </RequirePermission>
  );
}

function Inner() {
  const params = useSearchParams();
  const slipId = params.get('slip') ?? undefined;
  return slipId ? <Single id={slipId} /> : <List />;
}

function List() {
  const t = useTranslations('workPayroll');
  const locale = useLocale();
  const q = useMyPayslips({ limit: 24 });
  const items = q.data?.items ?? [];
  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('payslips.title')} description={t('payslips.description')} />
      <QueryState query={q} isEmpty={items.length === 0} emptyTitle={t('payslips.empty')} emptyDescription={t('payslips.emptyBody')}>
        <ul className="stagger-fast space-y-2" aria-label={t('payslips.listLabel')}>
          {items.map((s) => (
            <li key={s.id}>
              <Link href={`/work/payslips?slip=${s.id}`} aria-label={t('payslips.open', { month: formatMonth(s.month, locale) })} className="flex flex-wrap items-center justify-between gap-3 hover-lift rounded-lg border border-line bg-surface p-3.5 hover:border-gold-300 focus-visible:outline-2 focus-visible:outline-focus">
                <span className="font-medium text-ink">{formatMonth(s.month, locale)}</span>
                <span className="flex items-center gap-3">
                  <span className="text-right text-sm"><span className="block text-xs text-muted">{t('payslips.netPay')}</span><span className="font-medium tabular-nums">{formatMoney(s.net, s.currency)}</span></span>
                  <RunStatusBadge status={s.runStatus} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </QueryState>
    </>
  );
}

function Single({ id }: { id: string }) {
  const t = useTranslations('workPayroll');
  const locale = useLocale();
  const q = usePayslip(id);
  return (
    <QueryState query={q} isEmpty={!q.data} emptyTitle={t('payslips.empty')} emptyDescription={t('payslips.emptyBody')}>
      {q.data && (
        <>
          <PageHeader
            eyebrow={t('eyebrow')}
            title={t('payslips.documentTitle', { month: formatMonth(q.data.month, locale) })}
            actions={
              <>
                <Button asChild variant="ghost"><Link href="/work/payslips">{t('payslips.back')}</Link></Button>
                <Button leadingIcon={<Printer aria-hidden="true" />} onClick={() => window.print()}>{t('payslips.print')}</Button>
              </>
            }
          />
          <PayslipDocument slip={q.data} />
        </>
      )}
    </QueryState>
  );
}

/** Print CSS: only the payslip document is visible on paper, whatever the app shell around it contains. */
const PRINT_CSS = `@media print { body * { visibility: hidden !important; } #payslip-document, #payslip-document * { visibility: visible !important; } #payslip-document { position: absolute; left: 0; top: 0; width: 100%; border: 0 !important; box-shadow: none !important; color: #000 !important; background: #fff !important; } @page { margin: 14mm; } }`;

export function PayslipDocument({ slip }: { slip: Payslip }) {
  const t = useTranslations('workPayroll');
  const locale = useLocale();
  const fmt = useFormatDate();
  const cur = slip.currency;
  const lop = slip.basis.lopDays;
  return (
    <article id="payslip-document" aria-label={t('payslips.documentTitle', { month: formatMonth(slip.month, locale) })} className="enter-up accent-top max-w-3xl rounded-xl border border-line bg-surface p-5 md:p-8">
      <style>{PRINT_CSS}</style>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-gold-700 uppercase">{slip.organizationName ?? ''}</p>
          <h2 className="font-display text-2xl font-semibold text-ink">{t('payslips.documentTitle', { month: formatMonth(slip.month, locale) })}</h2>
        </div>
        <div className="print:hidden"><RunStatusBadge status={slip.runStatus} /></div>
      </header>
      <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-muted">{t('payslips.employee')}</dt><dd className="font-medium text-ink">{slip.userName ?? '—'}</dd></div>
        <div><dt className="text-muted">{t('payslips.month')}</dt><dd className="font-medium text-ink">{formatMonth(slip.month, locale)}</dd></div>
        <div><dt className="text-muted">{t('payslips.workingDays')}</dt><dd className="font-medium tabular-nums text-ink">{slip.monthWorkingDays}</dd></div>
        <div><dt className="text-muted">{t('payslips.employedDays')}</dt><dd className="font-medium tabular-nums text-ink">{slip.workingDays}</dd></div>
        <div><dt className="text-muted">{t('payslips.paidDays')}</dt><dd className="font-medium tabular-nums text-ink">{slip.paidDays}</dd></div>
        <div><dt className="text-muted">{t('payslips.lossOfPay')}</dt><dd className="font-medium tabular-nums text-ink">{slip.lossOfPayDays}</dd></div>
      </dl>
      <LineTable title={t('payslips.earnings')} lines={slip.earnings} currency={cur} />
      <LineTable title={t('payslips.deductions')} lines={slip.deductions} currency={cur} />
      <section className="mb-4" aria-labelledby="slip-adj">
        <h3 id="slip-adj" className="mb-1 text-sm font-semibold text-ink">{t('payslips.adjustments')}</h3>
        {slip.adjustments.length === 0 ? (
          <p className="text-sm text-muted">{t('payslips.none')}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {slip.adjustments.map((a) => (
              <li key={a.id} className="flex justify-between gap-2 py-1.5"><span>{a.label} <span className="text-xs text-muted">({t(`kind.${a.kind}`)})</span></span><span className="tabular-nums">{a.kind === 'DEDUCTION' ? '-' : '+'}{formatMoney(a.amount, cur)}</span></li>
            ))}
          </ul>
        )}
      </section>
      <dl className="mb-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-sm">
        <div><dt className="text-muted">{t('money.gross')}</dt><dd className="tabular-nums">{formatMoney(slip.gross, cur)}</dd></div>
        <div><dt className="text-muted">{t('money.deductions')}</dt><dd className="tabular-nums">{formatMoney(slip.totalDeductions, cur)}</dd></div>
        <div><dt className="text-muted">{t('money.adjustments')}</dt><dd className="tabular-nums">{formatMoney(slip.adjustmentsNet, cur)}</dd></div>
      </dl>
      <p className="glow-gold flex items-baseline justify-between rounded-md bg-champagne-100 px-4 py-3 print:bg-transparent print:px-0 print:shadow-none">
        <span className="font-semibold text-ink">{t('payslips.netPay')}</span>
        <span className="font-display text-2xl font-semibold tabular-nums text-ink">{formatMoney(slip.net, cur)}</span>
      </p>
      {lop.length > 0 && (
        <section className="mt-4 text-sm" aria-labelledby="slip-lop">
          <h3 id="slip-lop" className="mb-1 font-semibold text-ink">{t('payslips.lossOfPayDates')}</h3>
          <ul className="flex flex-wrap gap-2">
            {lop.map((d) => <li key={d.date}><Badge tone="red">{fmt.date(d.date)}: {d.fraction} · {t.has(`payslips.lopReason.${d.reason}` as never) ? t(`payslips.lopReason.${d.reason}` as never) : d.reason}</Badge></li>)}
          </ul>
        </section>
      )}
      <p className="mt-5 border-t border-line pt-3 text-xs text-muted">{t('payslips.footer')}</p>
    </article>
  );
}

function LineTable({ title, lines, currency }: { title: string; lines: Payslip['earnings']; currency: string }) {
  const t = useTranslations('workPayroll.payslips');
  return (
    <section className="mb-4">
      <table className="w-full text-sm">
        <caption className="mb-1 text-left text-sm font-semibold text-ink">{title}</caption>
        <thead className="text-left text-xs text-muted">
          <tr><th scope="col" className="py-1 font-medium">{t('component')}</th><th scope="col" className="py-1 text-right font-medium">{t('fullAmount')}</th><th scope="col" className="py-1 text-right font-medium">{t('payable')}</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {lines.length === 0 ? (
            <tr><td colSpan={3} className="py-1.5 text-muted">{t('none')}</td></tr>
          ) : (
            lines.map((l) => (
              <tr key={l.key}><th scope="row" className="py-1.5 text-left font-normal">{l.name}</th><td className="py-1.5 text-right tabular-nums text-muted">{formatMoney(l.fullAmount, currency)}</td><td className="py-1.5 text-right tabular-nums">{formatMoney(l.amount, currency)}</td></tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
