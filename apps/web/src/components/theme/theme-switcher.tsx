'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Tooltip,
  cn,
} from '@salesos/ui';
import { THEME_PREFERENCES, isThemePreference, type ThemePreference } from '@/lib/theme';
import { useTheme } from './theme-provider';

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/** Compact top-bar control: one icon button (shows the active theme) opening Light / Dark / System. */
export function ThemeMenu() {
  const t = useTranslations('theme');
  const { preference, resolved, setPreference } = useTheme();
  const Icon = preference === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun;
  return (
    <DropdownMenu>
      <Tooltip label={t('label')}>
        <DropdownMenuTrigger
          aria-label={`${t('label')}: ${t(preference)}`}
          className="inline-flex size-11 items-center justify-center rounded-md text-ink-700 hover:bg-ivory-200 md:size-10"
        >
          <Icon aria-hidden="true" className="size-[1.125rem]" />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(v) => {
            if (isThemePreference(v)) setPreference(v);
          }}
        >
          {THEME_PREFERENCES.map((p) => {
            const I = ICONS[p];
            return (
              <DropdownMenuRadioItem key={p} value={p}>
                <I aria-hidden="true" className="size-4" />
                {t(p)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Three-way segmented radio group (auth screens, settings). Arrow keys move and select. */
export function ThemeSegmented({ className }: { className?: string }) {
  const t = useTranslations('theme');
  const { preference, setPreference } = useTheme();
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next: ThemePreference = THEME_PREFERENCES[(i + d + THEME_PREFERENCES.length) % THEME_PREFERENCES.length]!;
    setPreference(next);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={t('label')}
      className={cn('inline-flex rounded-lg border border-line-strong bg-ivory-100 p-0.5', className)}
    >
      {THEME_PREFERENCES.map((p, i) => {
        const I = ICONS[p];
        const checked = preference === p;
        return (
          <button
            key={p}
            ref={(el) => {
              refs.current[p] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t(p)}
            tabIndex={checked ? 0 : -1}
            onClick={() => setPreference(p)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              'inline-flex size-10 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-focus',
              checked ? 'bg-surface text-gold-700 shadow-sm ring-1 ring-gold-400' : 'text-ink-600 hover:bg-ivory-200',
            )}
          >
            <I aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
