'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Target } from 'lucide-react';
import { Button, Skeleton } from '@salesos/ui';
import { useGoals, type Goal } from '@/lib/api/hooks/work-goals';
import { useAuth } from '@/features/auth/auth-provider';

const DAY_MS = 86_400_000;
const istFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
/** IST calendar day as a UTC day number. */
function istDay(d: Date): number {
  const [y, m, dd] = istFmt.format(d).split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, dd ?? 1) / DAY_MS;
}

export function goalDays(g: Pick<Goal, 'startDate' | 'targetDate'>, now = new Date()) {
  const start = istDay(new Date(g.startDate));
  const end = istDay(new Date(g.targetDate));
  const total = Math.max(1, end - start + 1);
  const day = Math.min(total, Math.max(1, istDay(now) - start + 1));
  return { day, total, left: Math.max(0, end - istDay(now)) };
}

const R = 42;
const C = 2 * Math.PI * R;

function Ring({ pct, label }: { pct: number; label: string }) {
  const gid = React.useId();
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <div className="relative size-[6.5rem] shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--color-gold-400)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--color-gold-600)' }} />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="8" className="stroke-ivory-300" />
        <circle
          cx="50" cy="50" r={R} fill="none" strokeWidth="8" strokeLinecap="round"
          stroke={`url(#${gid})`} className="transition-[stroke-dashoffset] duration-1000 ease-out"
          strokeDasharray={C} strokeDashoffset={C * (1 - shown / 100)}
        />
      </svg>
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-ink">{pct}%</span>
    </div>
  );
}

/** Shows the soonest-ending active goal. `href` is the goal list to link to (mobile `/m/goals` by default, `/work/goals` on desktop). */
export function GoalCard({ href = '/m/goals' }: { href?: string }) {
  const { can: canView } = useAuth();
  if (!canView('goals:view')) return null;
  return <GoalCardInner href={href} />;
}

function GoalCardInner({ href }: { href: string }) {
  const t = useTranslations('mobileGoal');
  const { can } = useAuth();
  const q = useGoals({ view: 'mine', status: 'ACTIVE', page: 1, limit: 10 });
  const goal = React.useMemo(() => {
    const items = (q.data?.items ?? []).filter((g) => g.status === 'ACTIVE');
    return items.sort((a, b) => new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime())[0] ?? null;
  }, [q.data]);

  const shell = 'rounded-2xl border border-line bg-surface p-4 shadow-sm';
  if (q.isLoading) {
    return (
      <section aria-busy="true" aria-label={t('title')} className={shell}>
        <Skeleton className="mb-3 h-5 w-32" />
        <div className="flex items-center gap-4"><Skeleton className="size-28 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-5 w-24" /><Skeleton className="h-4 w-20" /></div></div>
      </section>
    );
  }
  if (q.isError) {
    return (
      <section aria-label={t('title')} className={shell}>
        <h2 className="mb-2 text-base font-semibold text-ink">{t('title')}</h2>
        <p role="alert" className="mb-3 text-sm text-red-700">{t('error')}</p>
        <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>{t('retry')}</Button>
      </section>
    );
  }
  if (!goal) {
    return (
      <section aria-label={t('title')} className={shell}>
        <h2 className="mb-2 text-base font-semibold text-ink">{t('title')}</h2>
        <div className="flex items-center gap-3 text-sm text-muted">
          <Target className="size-5 shrink-0 text-gold-700" aria-hidden="true" />
          <p>{t('empty')}</p>
        </div>
        <Link href={href} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-gold-700 underline-offset-4 hover:underline">{t('viewGoals')}</Link>
      </section>
    );
  }
  const pct = Math.min(100, Math.max(0, Math.round(goal.progressPct)));
  const { day, total, left } = goalDays(goal);
  return (
    <section aria-label={t('title')} className={`${shell} enter-up`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{t('title')}</h2>
          {can('tasks:view') && <p className="text-xs text-muted">{t('subtitle')}</p>}
        </div>
        <Target aria-hidden="true" className="size-6 shrink-0 text-gold-700" />
      </div>
      <div className="flex items-center gap-4">
        <Ring pct={pct} label={t('percentAria', { pct })} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted">{goal.title}</p>
          <p className="mt-1 text-lg font-semibold text-ink">{t('dayOf', { day, total })}</p>
          <p className="text-sm text-muted">{t('daysToGo', { count: left })}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ivory-300" aria-hidden="true">
            <div className="h-full rounded-full bg-(image:--gold-gradient) transition-[width] duration-1000 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <Link href={href} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-gold-700 underline-offset-4 hover:underline">{t('viewGoals')}</Link>
    </section>
  );
}
