'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@salesos/ui';
import { ShieldCheck } from 'lucide-react';
import type { RoleKey } from '@/lib/api/types';

export function RoleBadges({ roles }: { roles: readonly RoleKey[] }) {
  const t = useTranslations('roles');
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <Badge key={r} tone="gold" icon={<ShieldCheck />}>
          {t(r)}
        </Badge>
      ))}
    </span>
  );
}

export function useDateTimeFormat(timeZone = 'Asia/Kolkata') {
  const locale = useLocale();
  return React.useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-IN' : locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    });
    return (iso?: string | null) => (iso ? fmt.format(new Date(iso)) : '—');
  }, [locale, timeZone]);
}
