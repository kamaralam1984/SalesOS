'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, Phone, Users } from 'lucide-react';
import { Skeleton } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { CountUp } from '@/components/shell/motion';
import { useDashboard } from '@/lib/api/hooks/analytics';
import { useLeads, useWorkspace } from '@/lib/api/hooks/crm';
import { useIsCallTeam } from '../call-team';

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
      className="enter-up glow-hover hover-lift flex min-h-[7.5rem] flex-col items-start justify-start gap-2 rounded-2xl border border-gold-400/40 bg-surface p-3 shadow-sm text-left focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-gold-500/70 bg-transparent text-gold-700">{icon}</span>
      <span className="mt-1 text-[0.8125rem] leading-tight font-medium text-ink-700">{label}</span>
      {loading ? (
        <Skeleton className="h-7 w-10" />
      ) : (
        <span className="kpi-number enter-fade tabular font-display mt-auto text-[1.75rem] leading-none font-bold text-ink">
          {value === null ? DASH : <CountUp text={text} locale={locale} />}
        </span>
      )}
    </Link>
  );
}

function LeadsTile({ locale, index }: { locale: string; index: number }) {
  const t = useTranslations('mobileStats');
  const q = useLeads({ mine: true, page: 1, limit: 1 });
  return <Tile index={index} href="/m/leads" label={t('leads')} icon={<Users aria-hidden="true" className="size-[1.125rem]" />} loading={q.isPending} value={q.data?.pagination?.total ?? null} locale={locale} />;
}

function CallsTile({ locale, index }: { locale: string; index: number }) {
  const t = useTranslations('mobileStats');
  const today = React.useMemo(() => istToday(), []);
  const q = useDashboard('salesperson', { from: today, to: today, asOf: today });
  const kpi = q.data?.kpis[CALL_KPI];
  const raw = kpi && kpi.status === 'OK' && kpi.value !== null ? Number(kpi.value) : null;
  const value = raw !== null && Number.isFinite(raw) ? raw : null;
  return <Tile index={index} href="/m/calls" label={t('calls')} icon={<Phone aria-hidden="true" className="size-[1.125rem]" />} loading={q.isPending} value={value} locale={locale} />;
}

function FollowUpsTile({ locale, index }: { locale: string; index: number }) {
  const t = useTranslations('mobileStats');
  const q = useWorkspace();
  return <Tile index={index} href="/m/calls" label={t('followUps')} icon={<CalendarDays aria-hidden="true" className="size-[1.125rem]" />} loading={q.isPending} value={q.data?.counts.tasksToday ?? null} locale={locale} />;
}

/** Only the tiles this role may use; each tile owns its hook, so no request is made for a hidden tile. */
export function StatTiles() {
  const t = useTranslations('mobileStats');
  const lc = useLocale();
  const { can } = useAuth();
  const callTeam = useIsCallTeam();
  const show = [
    can('leads:view') ? LeadsTile : null,
    // Calls Today and Follow-ups belong to the call team (sales team / telecallers) only
    callTeam && can('dashboard:salesperson:view') ? CallsTile : null,
    callTeam && can('tasks:view') ? FollowUpsTile : null,
  ].filter((x): x is typeof LeadsTile => x !== null);
  if (show.length === 0) return null;
  return (
    <section aria-label={t('title')} data-testid="mobile-stat-tiles">
      {/* always 3 columns so one or two tiles stay compact like the reference instead of stretching full width */}
      <div className="grid grid-cols-3 items-stretch gap-2.5">
        {show.map((C, i) => (
          <C key={C.name} locale={lc} index={i} />
        ))}
      </div>
    </section>
  );
}
