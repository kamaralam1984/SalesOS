'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { Badge, cn } from '@salesos/ui';
import { AccentRail } from './motion';
import { BrandLockup } from '../brand';
import { useAuth } from '@/features/auth/auth-provider';
import { visibleChildren, visibleNavSections } from '@/nav/registry';
import { isActivePath } from './nav-link-utils';

export function Sidebar() {
  const { can } = useAuth();
  const t = useTranslations('nav');
  const ts = useTranslations('shell');
  const pathname = usePathname();
  const sections = visibleNavSections(can);

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-w)] flex-col border-r border-line bg-gradient-to-b from-surface to-ivory-100 md:flex"
      aria-label={ts('primaryNav')}
    >
      <div className="relative flex h-[var(--topbar-h)] items-center border-b border-line px-5">
        <Link href="/" aria-label={ts('home')} className="rounded-md transition-transform duration-200 hover:scale-[1.02]">
          <BrandLockup />
        </Link>
        <AccentRail tone="tri" sheen className="absolute inset-x-0 -bottom-px h-px" />
      </div>
      <nav aria-label={ts('primaryNav')} className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {sections.map((s) => (
          <div key={s.sectionKey}>
            <p className="mb-1.5 px-3 text-[0.6875rem] font-semibold tracking-[0.14em] text-ink-500 uppercase">
              {t(`sections.${s.sectionKey}`)}
            </p>
            <ul className="space-y-0.5">
              {s.items.map((item) => {
                const children = visibleChildren(item, can);
                // an item is "open" (children shown) while the user is on it or on any of its sub-pages
                const open = children.length > 0 && (isActivePath(pathname, item.href) || children.some((c) => isActivePath(pathname, c.href)));
                const active = isActivePath(pathname, item.href) && !children.some((c) => isActivePath(pathname, c.href));
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-all duration-200 hover:translate-x-0.5',
                        active
                          ? 'bg-gradient-to-r from-gold-50 to-ivory-200 font-semibold text-ink shadow-[inset_0_0_0_1px_var(--gold-100),0_2px_12px_-6px_var(--gold-300)]'
                          : 'text-ink-700 hover:bg-ivory-200/70 hover:text-ink',
                      )}
                    >
                      {active && (
                        <motion.span
                          aria-hidden="true"
                          layoutId="sidebar-active-rail"
                          className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-gradient-to-b from-gold-300 via-gold-500 to-blue-600 shadow-[0_0_8px_1px_var(--gold-300)]"
                          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        />
                      )}
                      <span
                        aria-hidden="true"
                        className="absolute top-1/2 left-0 h-0 w-[3px] -translate-y-1/2 rounded-full bg-blue-500/70 transition-all duration-200 group-hover:h-4"
                      />
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          'size-[1.125rem] shrink-0',
                          'transition-transform duration-200 group-hover:scale-110',
                          active ? 'text-gold-700' : 'text-ink-500 group-hover:text-ink-700',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                      {item.comingInPhase && (
                        <Badge tone="neutral" className="px-1.5 py-0 text-[0.625rem]">
                          {ts('phaseShort', { phase: item.comingInPhase })}
                        </Badge>
                      )}
                    </Link>
                    {open && (
                      <ul aria-label={t(item.labelKey)} className="mt-0.5 mb-1 ml-5 space-y-0.5 border-l border-line pl-2" data-testid={`subnav-${item.id}`}>
                        {children.map((c) => {
                          const childActive = isActivePath(pathname, c.href);
                          return (
                            <li key={c.id}>
                              <Link
                                href={c.href}
                                aria-current={childActive ? 'page' : undefined}
                                className={cn(
                                  'enter-fade flex min-h-9 items-center rounded-md px-3 text-[0.8125rem] transition-all duration-200 hover:translate-x-0.5',
                                  childActive ? 'bg-ivory-200 font-semibold text-ink' : 'text-ink-700 hover:bg-ivory-100 hover:text-ink',
                                )}
                              >
                                <span className="min-w-0 truncate">{t(c.labelKey)}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <p className="border-t border-line px-5 py-3 text-[0.6875rem] text-ink-500">
        {ts('version')}
      </p>
    </aside>
  );
}
