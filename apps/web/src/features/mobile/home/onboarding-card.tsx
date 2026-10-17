'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { GraduationCap } from 'lucide-react';
import { Button, Skeleton } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { usePlans, type Plan } from '@/features/people/onboarding/api';

const DAY_MS = 86_400_000;
const PLAN_DAYS = 90;
const istFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
/** IST calendar day as a UTC day number. */
const istDay = (d: Date): number => {
  const [y, m, dd] = istFmt.format(d).split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, dd ?? 1) / DAY_MS;
};

/** Day N of the plan (1-based, IST); null when the 90 days are over or the plan has no start date. */
export function planDay(startDate: string | null, now = new Date()): number | null {
  if (!startDate) return null;
  const day = istDay(now) - istDay(new Date(startDate)) + 1;
  return day > PLAN_DAYS ? null : Math.max(1, day);
}

/** The person's own active onboarding plan, or undefined (managers also receive their team's plans, so match on the user id). */
export function myActivePlan(plans: Plan[] | undefined, userId: string | undefined, now = new Date()): Plan | undefined {
  if (!userId) return undefined;
  return (plans ?? []).find((p) => p.employeeId === userId && p.status === 'ACTIVE' && planDay(p.startDate, now) !== null);
}

/** "Day X of 90" for a new joiner: progress and the next steps. Renders nothing for anyone without an active plan. */
export function OnboardingCard({ href = '/people/onboarding' }: { href?: string }) {
  const { can } = useAuth();
  if (!can('onboarding:view')) return null;
  return <Inner href={href} />;
}

function Inner({ href }: { href: string }) {
  const t = useTranslations('mobileOnboarding');
  const { user } = useAuth();
  const q = usePlans();
  const plan = myActivePlan(q.data?.items, user?.id);
  const shell = 'enter-up rounded-2xl border border-line bg-surface p-4 shadow-sm';
  if (q.isLoading) return <section aria-busy="true" aria-label={t('title')} className={shell}><Skeleton className="mb-3 h-5 w-40" /><Skeleton className="h-16 w-full" /></section>;
  if (q.isError) {
    return (
      <section aria-label={t('title')} className={shell}>
        <h2 className="mb-2 text-base font-semibold text-ink">{t('title')}</h2>
        <p role="alert" className="mb-3 text-sm text-red-700">{t('error')}</p>
        <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>{t('retry')}</Button>
      </section>
    );
  }
  if (!plan) return null;
  const day = planDay(plan.startDate) ?? 1;
  const pct = plan.progress.pct ?? 0;
  const startDay = istDay(new Date(plan.startDate as string));
  const next = plan.items
    .filter((i) => i.status === 'PENDING')
    .sort((a, b) => new Date(a.dueDate ?? '9999-12-31').getTime() - new Date(b.dueDate ?? '9999-12-31').getTime())
    .slice(0, 3);
  return (
    <section aria-label={t('title')} className={shell}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{t('title')}</h2>
          <p className="text-lg font-semibold text-ink">{t('dayOf', { day, total: PLAN_DAYS })}</p>
        </div>
        <GraduationCap aria-hidden="true" className="size-6 shrink-0 text-gold-700" />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ivory-300" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('done', { done: plan.progress.done, total: plan.progress.total })}>
        <div className="h-full rounded-full bg-(image:--gold-gradient) transition-[width] duration-1000 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-sm text-muted">{t('done', { done: plan.progress.done, total: plan.progress.total })}</p>
      {next.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-medium text-ink">{t('next')}</h3>
          <ul className="mt-1 divide-y divide-line text-sm">
            {next.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-2 py-1.5">
                <span className="text-ink">{i.title}</span>
                <span className={`shrink-0 ${i.overdue ? 'font-medium text-red-700' : 'text-muted'}`}>
                  {i.overdue ? t('overdue') : t('due', { day: i.dueDate ? istDay(new Date(i.dueDate)) - startDay + 1 : '—' })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link href={href} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-gold-700 underline-offset-4 hover:underline">{t('open')}</Link>
    </section>
  );
}
