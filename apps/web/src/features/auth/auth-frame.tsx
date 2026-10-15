'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, ListChecks, ShieldCheck, UserCheck } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { Input, cn } from '@salesos/ui';
import { AccentRail, Reveal } from '@/components/shell/motion';
import { BrandLockup } from '@/components/brand';
import { LanguageSwitch } from '@/components/shell/top-bar';
import { ThemeSegmented } from '@/components/theme/theme-switcher';

/** Split-screen frame for sign-in style pages. Editorial copy on the left (desktop), form card on the right. */
export function AuthFrame({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = useTranslations('auth');
  const reduce = useReducedMotion();
  const points = [
    { Icon: UserCheck, text: t('pointOwner') },
    { Icon: ListChecks, text: t('pointNextAction') },
    { Icon: ShieldCheck, text: t('pointAudit') },
  ];
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="bg-ruled relative hidden flex-col justify-between overflow-hidden border-r border-line bg-sunken p-12 lg:flex xl:p-16">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {[
            { top: '18%', tone: 'gold' as const, d: 0.3 },
            { top: '46%', tone: 'blue' as const, d: 0.6 },
            { top: '74%', tone: 'green' as const, d: 0.9 },
          ].map((l) => (
            <motion.div
              key={l.tone}
              className="absolute left-0 w-full"
              style={{ top: l.top }}
              initial={reduce ? false : { opacity: 0, x: -60 }}
              animate={reduce ? undefined : { opacity: [0.25, 0.7, 0.25], x: [0, 18, 0] }}
              transition={{ duration: 7, delay: l.d, repeat: Infinity, ease: 'easeInOut' }}
            >
              <AccentRail tone={l.tone} delay={l.d} className="h-px" />
            </motion.div>
          ))}
          <motion.div
            className="absolute -top-24 -right-24 size-80 rounded-full bg-gold-100/60 blur-3xl"
            animate={reduce ? undefined : { opacity: [0.55, 1, 0.55], scale: [1, 1.12, 1] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute -bottom-28 -left-16 size-80 rounded-full bg-blue-100/50 blur-3xl"
            animate={reduce ? undefined : { opacity: [1, 0.55, 1], scale: [1.08, 1, 1.08] }}
            transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
        <Reveal className="relative"><BrandLockup /></Reveal>
        <Reveal className="relative max-w-xl" delay={0.15}>
          <AccentRail tone="tri" sheen className="mb-8 w-28" />
          <p className="font-display text-[2.75rem] leading-[1.1] font-semibold tracking-tight text-ink xl:text-[3.25rem]">
            {t('headline')}
          </p>
          <ul className="mt-10 space-y-4">
            {points.map(({ Icon, text }) => (
              <li key={text} className="flex items-start gap-3.5 text-[0.9375rem] text-ink-700">
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-gold-300 bg-gradient-to-br from-gold-50 to-gold-100 text-gold-700 shadow-sm"
                >
                  <Icon className="size-4" />
                </span>
                <span className="pt-1">{text}</span>
              </li>
            ))}
          </ul>
        </Reveal>
        <p className="relative text-xs text-ink-500">{t('footnote')}</p>
      </aside>

      <main id="main" className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <BrandLockup className="lg:invisible" />
          <div className="flex items-center gap-2">
            <ThemeSegmented />
            <LanguageSwitch />
          </div>
        </div>
        <Reveal className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-10" delay={0.1}>
        <div className="border-glow relative rounded-2xl border border-line bg-surface p-6 [box-shadow:var(--shadow-lg)] sm:p-8">
          <h1 className="enter-up font-display text-[2rem] leading-tight font-semibold tracking-tight text-ink">
            {title}
          </h1>
          {description && <p className="mt-2 text-[0.9375rem] text-muted">{description}</p>}
          <AccentRail tone="tri" className="my-6 max-w-24" />
          {children}
          {footer && <div className="mt-6 text-sm text-muted">{footer}</div>}
        </div>
        </Reveal>
      </main>
    </div>
  );
}

/** Password input with a visible show/hide toggle (keeps native autofill + password-manager behaviour). */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function PasswordInput({ className, ...props }, ref) {
  const [shown, setShown] = React.useState(false);
  const t = useTranslations('auth');
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={shown ? 'text' : 'password'}
        className={cn('pr-12', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t('hidePassword') : t('showPassword')}
        aria-pressed={shown}
        className="absolute inset-y-0 right-1 my-auto inline-flex size-9 items-center justify-center rounded-md text-ink-500 hover:bg-ivory-200 hover:text-ink"
      >
        {shown ? (
          <EyeOff className="size-[1.125rem]" aria-hidden="true" />
        ) : (
          <Eye className="size-[1.125rem]" aria-hidden="true" />
        )}
      </button>
    </div>
  );
});
