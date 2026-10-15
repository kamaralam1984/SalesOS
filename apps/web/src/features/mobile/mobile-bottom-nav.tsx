'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { House, Phone, Target, User, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@salesos/ui';

interface Item {
  href: string;
  key: 'home' | 'leads' | 'calls' | 'goals' | 'profile';
  icon: LucideIcon;
}

const ITEMS: readonly Item[] = [
  { href: '/m', key: 'home', icon: House },
  { href: '/m/leads', key: 'leads', icon: Users },
  { href: '/m/calls', key: 'calls', icon: Phone },
  { href: '/m/goals', key: 'goals', icon: Target },
  { href: '/m/profile', key: 'profile', icon: User },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/m' ? pathname === '/m' : pathname === href || pathname.startsWith(href + '/');
}

export function MobileBottomNav() {
  const t = useTranslations('mobileShell');
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('navLabel')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {ITEMS.map(({ href, key, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={key} className="flex flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-[3.5rem] min-w-11 flex-1 flex-col items-center justify-center gap-1 px-1 text-[0.6875rem] font-medium transition-all duration-150 active:scale-90',
                  active ? 'text-gold-300' : 'text-muted hover:text-ink',
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn('size-5', active && 'drop-shadow-[0_0_8px_var(--gold-300)]')}
                />
                <span>{t(`nav.${key}`)}</span>
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 h-[3px] w-8 rounded-full bg-gold-300 shadow-[0_0_10px_1px_var(--gold-300)]"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
