'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ExternalLink, LogOut, ShieldCheck } from 'lucide-react';
import { Avatar, Button, Card } from '@salesos/ui';
import { useAuth } from '@/features/auth/auth-provider';
import { LanguageSwitch } from '@/components/shell/top-bar';
import { ThemeMenu } from '@/components/theme/theme-switcher';

export function ProfilePage() {
  const t = useTranslations('mobileShell');
  const tr = useTranslations('roles');
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="stagger space-y-4">
      <h1 className="text-xl font-semibold text-ink">{t('profile.title')}</h1>
      <Card className="flex flex-col items-center gap-3 p-6 text-center">
        <Avatar name={user.name} size="lg" />
        <div className="min-w-0 max-w-full">
          <p className="truncate text-lg font-semibold text-ink">{user.name}</p>
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
        <ul className="flex flex-wrap justify-center gap-1.5" aria-label={t('profile.roles')}>
          {user.roles.map((r) => (
            <li
              key={r}
              className="inline-flex items-center gap-1 rounded-full border border-gold-400 bg-gold-50 px-2 py-0.5 text-[0.6875rem] font-medium text-gold-700"
            >
              <ShieldCheck aria-hidden="true" className="size-3" />
              {tr(r)}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex items-center justify-between gap-3 p-4">
        <span className="text-sm font-medium text-ink">{t('profile.language')}</span>
        <LanguageSwitch />
      </Card>
      <Card className="flex items-center justify-between gap-3 p-4">
        <span className="text-sm font-medium text-ink">{t('profile.theme')}</span>
        <ThemeMenu />
      </Card>
      <div className="space-y-3">
        <Button asChild variant="secondary" className="min-h-11 w-full">
          <Link href="/dashboard?classic=1">
            <ExternalLink aria-hidden="true" className="size-4" />
            {t('profile.openStandard')}
          </Link>
        </Button>
        <Button
          variant="ghost"
          className="min-h-11 w-full"
          onClick={() => void logout('manual')}
        >
          <LogOut aria-hidden="true" className="size-4" />
          {t('profile.signOut')}
        </Button>
      </div>
    </div>
  );
}
