'use client';
import { useTranslations } from 'next-intl';
import { Badge, Button } from '@salesos/ui';
import { usePermission } from '@/features/auth/auth-provider';
import { useFmt } from '../hrkit/kit';
import { useUpdateItem, type Plan } from './api';

export function ProgressBar({ pct, label }: { pct: number | null; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} className="h-2 w-full overflow-hidden rounded-full bg-ivory-200">
      <div className="h-full bg-gold-500 shadow-[0_0_8px_rgb(201_162_39/0.45)] motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${pct ?? 0}%` }} />
    </div>
  );
}

export function PlanCard({ plan }: { plan: Plan }) {
  const t = useTranslations('onboarding');
  const fmt = useFmt();
  const canManage = usePermission('onboarding:manage');
  const update = useUpdateItem();
  const p = plan.progress;
  return (
    <li className="accent-top hover-lift rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">{plan.employeeName ?? '—'}</h3>
        <Badge tone={plan.status === 'COMPLETED' ? 'green' : 'blue'}>{t(`planStatus.${plan.status}` as never)}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">{t('plans.started', { date: fmt.date(plan.startDate) })}</p>
      <div className="mt-2">
        <ProgressBar pct={p.pct} label={t('plans.progress')} />
        <p className="mt-1 text-xs text-muted">{p.pct === null ? t('plans.noProgress') : t('plans.progressText', { done: p.done, total: p.total - p.skipped, pct: p.pct })}</p>
      </div>
      <ul className="mt-3 space-y-2">
        {plan.items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-ivory-100 px-3 py-2 text-sm">
            <span className={i.status === 'DONE' ? 'text-muted line-through' : 'text-ink'}>
              {i.title}
              <span className="ml-2 text-xs text-muted">{t(`category.${i.category}` as never)} · {t('plans.due', { date: fmt.date(i.dueDate) })}</span>
              {i.overdue && <Badge tone="red" className="ml-2">{t('plans.overdue')}</Badge>}
              {i.status === 'SKIPPED' && <Badge tone="neutral" className="ml-2">{t('plans.skipped')}</Badge>}
            </span>
            {plan.status === 'ACTIVE' && i.status === 'PENDING' && (
              <span className="flex gap-1.5">
                <Button size="sm" variant="secondary" loading={update.isPending && update.variables?.id === i.id} onClick={() => update.mutate({ id: i.id, status: 'DONE' })}>{t('plans.markDone')}</Button>
                {canManage && <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: i.id, status: 'SKIPPED' })}>{t('plans.skip')}</Button>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}
