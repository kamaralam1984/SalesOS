'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, Languages, LogOut, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@salesos/ui';
import { BrandMark } from '../brand';
import { AccentRail } from './motion';
import { useAuth } from '@/features/auth/auth-provider';
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, isLocale, type Locale } from '@/i18n/config';
import { useLocale } from 'next-intl';
import { HintsToggle } from '@/features/hints/hint-views';
import { useHints } from '@/features/hints/hints-provider';
import { ThemeMenu } from '@/components/theme/theme-switcher';
import { NotificationBell } from '@/features/notifications/notification-bell';

export function LanguageSwitch() {
  const t = useTranslations('shell');
  const locale = useLocale();
  const router = useRouter();
  return (
    <DropdownMenu>
      <Tooltip label={t('language')}>
        <DropdownMenuTrigger
          aria-label={t('language')}
          className="inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink-700 transition-colors duration-200 hover:bg-ivory-200 data-[state=open]:bg-ivory-200"
        >
          <Languages aria-hidden="true" className="size-[1.125rem]" />
          <span className="hidden sm:inline">{LOCALE_NAMES[isLocale(locale) ? locale : 'en']}</span>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(v) => {
            if (!isLocale(v)) return;
            document.cookie = `${LOCALE_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
            router.refresh();
          }}
        >
          {LOCALES.map((l: Locale) => (
            <DropdownMenuRadioItem key={l} value={l} lang={l}>
              {LOCALE_NAMES[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const t = useTranslations('shell');
  const tr = useTranslations('roles');
  const th = useTranslations('hints.ui');
  const hints = useHints();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('userMenu')}
        className="flex h-11 items-center gap-2 rounded-full py-1 pr-2 pl-1 transition-all duration-200 hover:bg-ivory-200 hover:shadow-[0_0_0_1px_var(--gold-100),0_2px_12px_-6px_var(--gold-300)] data-[state=open]:bg-ivory-200 md:h-10"
      >
        <Avatar name={user.name} size="md" />
        <span className="hidden max-w-36 truncate text-left text-sm leading-tight font-medium text-ink lg:block">
          {user.name}
        </span>
        <ChevronDown aria-hidden="true" className="hidden size-4 text-ink-500 lg:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <div className="px-3 py-2.5">
          <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
          <p className="truncate text-[0.8125rem] text-muted">{user.email}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {user.roles.map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1 rounded-full border border-gold-300 bg-gold-50 px-2 py-0.5 text-[0.6875rem] font-medium text-gold-700"
              >
                <ShieldCheck aria-hidden="true" className="size-3" />
                {tr(r)}
              </span>
            ))}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => hints.reset()}>
          <RotateCcw aria-hidden="true" className="size-4" />
          {th('reset')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void logout('manual')}>
          <LogOut aria-hidden="true" className="size-4" />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  const t = useTranslations('shell');
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className="flex h-[var(--topbar-h)] items-center gap-2 px-3 md:px-8">
        <Link href="/" aria-label={t('home')} className="rounded-md md:hidden">
          <BrandMark />
        </Link>
        <div className="flex-1" />
        <HintsToggle />
        <LanguageSwitch />
        <ThemeMenu />
        <NotificationBell />
        <UserMenu />
      </div>
      <AccentRail tone="gold" className="absolute inset-x-0 bottom-[-1px] h-px" />
    </header>
  );
}
