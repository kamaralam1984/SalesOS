'use client';
import { useTranslations } from 'next-intl';
import { Badge, Button } from '@salesos/ui';
import { usePermission } from '@/features/auth/auth-provider';
import { useFmt } from '../hrkit/kit';
import type { BenchCandidate, Position } from './api';

const COVERAGE_TONE = { COVERED: 'green', DEVELOPING: 'gold', NO_BENCH: 'red' } as const;

export function SuccessionBoard({ positions, onAdd, onMove, onRemove }: {
  positions: Position[];
  onAdd?: (p: Position) => void;
  onMove?: (p: Position, c: BenchCandidate) => void;
  onRemove?: (c: BenchCandidate) => void;
}) {
  const t = useTranslations('succession');
  const canManage = usePermission('succession:manage');
  return (
    <ul className="stagger space-y-4">
      {positions.map((p) => (
        <li key={p.id} className="accent-top hover-lift rounded-lg border border-line bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="break-words font-semibold text-ink">{p.title}</h3>
              <p className="text-sm text-muted">{t('incumbent', { name: p.incumbentName ?? t('vacant') })}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={COVERAGE_TONE[p.coverage]}>{t(`coverage.${p.coverage}` as never)}</Badge>
              {canManage && onAdd && <Button size="sm" variant="secondary" onClick={() => onAdd(p)}>{t('addBench')}</Button>}
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Column title={t('readyNow')} items={p.readyNow} p={p} onMove={canManage ? onMove : undefined} onRemove={canManage ? onRemove : undefined} />
            <Column title={t('readyLater')} items={p.readyLater} p={p} onMove={canManage ? onMove : undefined} onRemove={canManage ? onRemove : undefined} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Column({ title, items, p, onMove, onRemove }: { title: string; items: BenchCandidate[]; p: Position; onMove?: (p: Position, c: BenchCandidate) => void; onRemove?: (c: BenchCandidate) => void }) {
  const t = useTranslations('succession');
  const fmt = useFmt();
  return (
    <section aria-label={title} className="rounded-md bg-ivory-100 p-3">
      <h4 className="mb-2 text-sm font-semibold text-ink-600">{title} ({items.length})</h4>
      {items.length === 0 ? <p className="text-sm text-muted">{t('nobody')}</p> : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="hover-lift rounded-md border border-line bg-surface p-2.5 text-sm">
              <p className="font-medium text-ink">{c.name ?? '—'}</p>
              {c.developmentActions.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs text-ink-600">{c.developmentActions.map((a, i) => <li key={i}>{a.title}{a.dueDate ? ` (${fmt.date(a.dueDate)})` : ''} · {t(`actionStatus.${a.status}` as never)}</li>)}</ul>
              )}
              {c.notes && <p className="mt-1 text-xs text-muted">{c.notes}</p>}
              {(onMove || onRemove) && (
                <div className="mt-2 flex gap-1.5">
                  {onMove && <Button size="sm" variant="secondary" onClick={() => onMove(p, c)}>{c.readiness === 'READY_NOW' ? t('moveLater') : t('moveNow')}</Button>}
                  {onRemove && <Button size="sm" variant="ghost" onClick={() => onRemove(c)}>{t('remove')}</Button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
