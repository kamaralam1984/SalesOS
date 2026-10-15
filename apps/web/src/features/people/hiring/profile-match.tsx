'use client';
import { useTranslations } from 'next-intl';
import { Badge } from '@salesos/ui';
import type { Criterion, ProfileMatch } from './api';

const TONE: Record<Criterion, 'green' | 'red' | 'neutral' | 'gold'> = { MET: 'green', NOT_MET: 'red', UNKNOWN: 'gold', NOT_REQUIRED: 'neutral' };

/** Facts against the configurable role profile. UNKNOWN means "not recorded" - it is never shown as a failure, and there is no score. */
export function ProfileMatchList({ match }: { match: ProfileMatch | null }) {
  const t = useTranslations('hiring');
  if (!match) return <p className="text-sm text-muted">{t('match.noProfile')}</p>;
  const rows: Array<[string, Criterion]> = [
    ['experience', match.experience], ['teamManagement', match.teamManagement], ['industry', match.industry], ['education', match.education],
  ];
  return (
    <div>
      <ul aria-label={t('match.title')} className="space-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <li key={k} className="flex items-center justify-between gap-3">
            <span>{t(`match.${k}` as never)}</span>
            <Badge tone={TONE[v]}>{t(`match.value.${v}` as never)}</Badge>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">{t('match.note')}</p>
    </div>
  );
}
