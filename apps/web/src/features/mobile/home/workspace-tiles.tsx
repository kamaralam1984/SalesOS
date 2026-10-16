'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, LayoutGrid } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-provider';
import { visibleNavSections } from '@/nav/registry';

const MORE_THRESHOLD = 3;
const MORE_MAX = 6;

interface WorkspaceTilesProps {
  /** `full`: the main content for roles without CRM access. `more`: a compact "All areas" list under the CRM widgets. */
  variant: 'full' | 'more';
}

/** Card shortcuts to the areas this role can open (same data as the workspace home). UI hiding only. */
export function WorkspaceTiles({ variant }: WorkspaceTilesProps) {
  const t = useTranslations('mobileShell');
  const tn = useTranslations('nav');
  const { can } = useAuth();
  const all = visibleNavSections(can)
    .flatMap((s) => s.items.map((item) => ({ item, sectionKey: s.sectionKey })))
    .filter(({ item }) => item.href !== '/dashboard');
  const more = variant === 'more';
  if (more && all.length <= MORE_THRESHOLD) return null;
  const items = more ? all.slice(0, MORE_MAX) : all;

  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6 text-center" data-testid="mobile-workspace-empty">
        <LayoutGrid aria-hidden="true" className="mx-auto mb-3 size-8 text-gold-700" />
        <h2 className="text-base font-semibold text-ink">{t('workspace.emptyTitle')}</h2>
        <p className="mt-1 text-sm text-muted">{t('workspace.emptyBody')}</p>
      </section>
    );
  }

  return (
    <section aria-label={t('workspace.allAreas')} data-testid="mobile-workspace-tiles">
      {more && (
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">{t('workspace.allAreas')}</h2>
          <Link href="/dashboard?classic=1" className="inline-flex min-h-11 items-center text-sm font-medium text-gold-700 underline-offset-4 hover:underline">
            {t('workspace.seeAll')}
          </Link>
        </div>
      )}
      <ul className="stagger space-y-2">
        {items.map(({ item, sectionKey }) => {
          const Icon = item.icon;
          const title = tn(item.labelKey as never);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-label={t('workspace.open', { name: title })}
                className="hover-lift flex min-h-16 items-center gap-3 rounded-2xl border border-gold-400/60 bg-surface p-3 shadow-sm focus-visible:outline-2 focus-visible:outline-focus"
              >
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-gold-500/60 bg-gold-50 text-gold-700">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{title}</span>
                  <span className="block truncate text-xs text-muted">{tn(`sections.${sectionKey}` as never)}</span>
                </span>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-gold-700" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
