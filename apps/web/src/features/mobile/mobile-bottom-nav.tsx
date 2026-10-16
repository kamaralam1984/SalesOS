'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BriefcaseBusiness, House, PhoneCall, Target, User, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { workNav } from '@/nav/work';
import { useIsCallTeam } from './call-team';

interface Item {
  href: string;
  key: 'home' | 'leads' | 'calls' | 'goals' | 'work' | 'profile';
  icon: LucideIcon;
  permission?: string;
}

const ITEMS: readonly Item[] = [
  { href: '/m', key: 'home', icon: House },
  { href: '/m/leads', key: 'leads', icon: Users, permission: 'leads:view' },
  { href: '/m/calls', key: 'calls', icon: PhoneCall, permission: 'tasks:view' },
  { href: '/m/goals', key: 'goals', icon: Target, permission: 'goals:view' },
  { href: '/m/profile', key: 'profile', icon: User },
];

const WORK_ITEM: Item = {
  href: '/work',
  key: 'work',
  icon: BriefcaseBusiness,
  permission: workNav.items.find((i) => i.href === '/work')?.permission as string | undefined,
};

function isActive(pathname: string, href: string): boolean {
  return href === '/m' ? pathname === '/m' : pathname === href || pathname.startsWith(href + '/');
}

export function MobileBottomNav() {
  const t = useTranslations('mobileShell');
  const pathname = usePathname();
  const { can } = useAuth();
  const callTeam = useIsCallTeam();
  // the Calls tab (call system) is for the sales team / telecallers only
  const visible = ITEMS.filter((i) => (!i.permission || can(i.permission)) && (i.key !== 'calls' || callTeam));
  if (visible.length < ITEMS.length && can(WORK_ITEM.permission)) {
    visible.splice(visible.length - 1, 0, WORK_ITEM);
  }
  return (
    <nav
      aria-label={t('navLabel')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-gold-400/25 bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {visible.map(({ href, key, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={key} className="flex flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-[3.5rem] min-w-11 flex-1 flex-col items-center justify-center gap-1 px-1 text-[0.6875rem] font-medium transition-all duration-150 active:scale-90',
                  active ? 'text-gold-700' : 'text-muted hover:text-ink',
                )}
              >
                <Icon
                  aria-hidden="true"
                  className="size-5"
                />
                <span>{t(`nav.${key}`)}</span>
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 h-[2px] w-6 rounded-full bg-gold-600"
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
