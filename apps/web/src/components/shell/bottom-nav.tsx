'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Ellipsis } from 'lucide-react';
import { motion } from 'framer-motion';
import { Sheet, SheetContent, SheetTrigger, cn } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { activeNavItem, mobileNav, visibleChildren } from '@/nav/registry';
import { isActivePath } from './nav-link-utils';

export function BottomNav() {
  const { can } = useAuth();
  const t = useTranslations('nav');
  const ts = useTranslations('shell');
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const { primary, more } = mobileNav(can);
  const moreActive = more.some((i) => isActivePath(pathname, i.href));
  // sub-pages of the section the user is in stay reachable on phones (they are not in the bottom bar)
  const section = activeNavItem(pathname, [...primary, ...more]);
  const subPages = section ? visibleChildren(section, can) : [];

  const itemCls = (active: boolean) =>
    cn(
      'relative flex min-h-[var(--bottomnav-h)] flex-1 flex-col items-center justify-center gap-1 px-1 text-[0.6875rem] font-medium transition-all duration-150 active:scale-90',
      active ? 'text-ink' : 'text-ink-500',
    );

  return (
    <nav
      aria-label={ts('mobileNav')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-safe [box-shadow:0_-1px_0_var(--line)] backdrop-blur-sm md:hidden"
    >
      <ul className="mx-auto flex max-w-xl items-stretch">
        {primary.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.id} className="flex flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={itemCls(active)}
              >
                {active && (
                  <motion.span
                    aria-hidden="true"
                    layoutId="bottomnav-active-line"
                    className="absolute top-0 h-[3px] w-10 rounded-full bg-gradient-to-r from-gold-300 via-gold-500 to-blue-600 shadow-[0_2px_10px_1px_var(--gold-300)]"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                {active && (
                  <motion.span
                    aria-hidden="true"
                    layoutId="bottomnav-active-pill"
                    className="absolute inset-x-2 inset-y-1.5 -z-10 rounded-xl bg-gold-50/80 shadow-[0_0_14px_-4px_var(--gold-300)]"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <Icon aria-hidden="true" className={cn('size-5 transition-transform duration-200', active && '-translate-y-0.5 scale-110 text-gold-700')} />
                <span className="max-w-full truncate">{t(item.labelKey)}</span>
              </Link>
            </li>
          );
        })}
        {(more.length > 0 || subPages.length > 0) && (
          <li className="flex flex-1">
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger className={itemCls(moreActive)}>
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute top-0 h-[2px] w-8 rounded-full bg-gold-500 transition-opacity',
                    moreActive ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <Ellipsis aria-hidden="true" className="size-5" />
                <span>{ts('more')}</span>
              </SheetTrigger>
              <SheetContent side="bottom" title={ts('moreTitle')} closeLabel={ts('close')}>
                <ul className="grid grid-cols-1 gap-1">
                  {more.map((item) => {
                    const Icon = item.icon;
                    const active = isActivePath(pathname, item.href);
                    return (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex min-h-12 items-center gap-3 rounded-md px-3 text-[0.9375rem]',
                            active ? 'bg-ivory-200 font-semibold' : 'hover:bg-ivory-100',
                          )}
                        >
                          <Icon aria-hidden="true" className="size-5 text-gold-700" />
                          {t(item.labelKey)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {section && subPages.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="px-3 pb-1 text-[0.6875rem] font-semibold tracking-[0.14em] text-ink-500 uppercase">{t(section.labelKey)}</p>
                    <ul className="grid grid-cols-1 gap-1" data-testid="mobile-subnav">
                      {subPages.map((c) => (
                        <li key={c.id}>
                          <Link
                            href={c.href}
                            onClick={() => setMoreOpen(false)}
                            aria-current={isActivePath(pathname, c.href) ? 'page' : undefined}
                            className={cn('flex min-h-11 items-center rounded-md px-3 text-[0.9375rem]', isActivePath(pathname, c.href) ? 'bg-ivory-200 font-semibold' : 'hover:bg-ivory-100')}
                          >
                            {t(c.labelKey)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </SheetContent>
            </Sheet>
          </li>
        )}
      </ul>
    </nav>
  );
}
