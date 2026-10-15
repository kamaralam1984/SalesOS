'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Phone, RotateCw, Users } from 'lucide-react';
import { Button, Skeleton } from '@salesos/ui';
import { CountUp } from '@/components/shell/motion';
import { useDashboard } from '@/lib/api/hooks/analytics';
import { useLeads, useWorkspace } from '@/lib/api/hooks/crm';

const CALL_KPI = 'KPI-PRD-006';
const DASH = '—';

/** Today's calendar date (YYYY-MM-DD) in the business timezone. */
function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

interface TileProps {
  href: string;
  label: string;
  icon: React.ReactNode;
  loading: boolean;
  value: number | null;
  locale: string;
  index: number;
}

function Tile({ href, label, icon, loading, value, locale, index }: TileProps) {
  const text = value === null ? DASH : new Intl.NumberFormat(locale).format(value);
  return (
    <Link
      href={href}
      aria-label={value === null ? label : `${label}: ${text}`}
      style={{ '--enter-delay': `${index * 70}ms` } as React.CSSProperties}
      className="enter-up glow-hover hover-lift flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border border-gold-300/50 bg-surface p-3 text-center focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span className="inline-flex size-9 items-center justify-center rounded-full border border-gold-400/70 text-gold-500">{icon}</span>
      <span className="text-xs font-medium text-muted">{label}</span>
      {loading ? (
        <Skeleton className="h-7 w-10" />
      ) : (
        <span className="kpi-number enter-fade tabular font-display text-2xl leading-none font-semibold text-ink">
          {value === null ? DASH : <CountUp text={text} locale={locale} />}
        </span>
      )}
    </Link>
  );
}

/** My Leads, Calls Today and Follow-ups, each from an existing real endpoint; unavailable numbers show an em dash. */
export function StatTiles() {
  const t = useTranslations('mobileStats');
  const lc = useLocale();
  const today = React.useMemo(() => istToday(), []);
  const leads = useLeads({ mine: true, page: 1, limit: 1 });
  const workspace = useWorkspace();
  const dash = useDashboard('salesperson', { from: today, to: today, asOf: today });

  const leadsValue = leads.data?.pagination?.total ?? null;
  const callKpi = dash.data?.kpis[CALL_KPI];
  const callsRaw = callKpi && callKpi.status === 'OK' && callKpi.value !== null ? Number(callKpi.value) : null;
  const callsValue = callsRaw !== null && Number.isFinite(callsRaw) ? callsRaw : null;
  const followValue = workspace.data?.counts.tasksToday ?? null;

  const failed = leads.isError || workspace.isError || dash.isError;
  const retry = () => {
    if (leads.isError) void leads.refetch();
    if (workspace.isError) void workspace.refetch();
    if (dash.isError) void dash.refetch();
  };

  return (
    <section aria-label={t('title')} data-testid="mobile-stat-tiles">
      <div className="grid grid-cols-3 gap-3">
        <Tile index={0} href="/m/leads" label={t('leads')} icon={<Users aria-hidden="true" className="size-[1.125rem]" />} loading={leads.isPending} value={leadsValue} locale={lc} />
        <Tile index={1} href="/m/calls" label={t('calls')} icon={<Phone aria-hidden="true" className="size-[1.125rem]" />} loading={dash.isPending} value={callsValue} locale={lc} />
        <Tile index={2} href="/m/calls" label={t('followUps')} icon={<RotateCw aria-hidden="true" className="size-[1.125rem]" />} loading={workspace.isPending} value={followValue} locale={lc} />
      </div>
      {failed && (
        <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted">
          <span>{t('error')}</span>
          <Button size="sm" variant="ghost" onClick={retry}>
            {t('retry')}
          </Button>
        </div>
      )}
    </section>
  );
}
