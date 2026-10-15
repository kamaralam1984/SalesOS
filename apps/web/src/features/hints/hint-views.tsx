'use client';
import * as React from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Lightbulb } from 'lucide-react';
import { HintTip, PageHint, PageHintSlotProvider, Tooltip, cn } from '@salesos/ui';
import {
  PAGE_HINTS,
  TIP_HINTS,
  matchPageHint,
  type PageHintDef,
  type PageHintId,
  type TipHintId,
} from './catalogue';
import { useHints } from './hints-provider';

/** The page-level hint card for one catalogue id. Renders nothing when hints are off. */
export function PageHintView({ id }: { id: PageHintId }) {
  const t = useTranslations('hints');
  const hints = useHints();
  if (!hints.ready || !hints.enabled) return null;
  const def: PageHintDef = PAGE_HINTS[id];
  const dismissed = hints.isDismissed(id);
  return (
    <PageHint
      labels={{
        title: t('ui.pageTitle'),
        whatLabel: t('ui.what'),
        firstLabel: t('ui.first'),
        tipLabel: t('ui.tip'),
        collapse: t('ui.collapse'),
        expand: t('ui.expand'),
        dismiss: t('ui.dismiss'),
        restore: t('ui.restore'),
      }}
      what={t(`page.${id}.what`)}
      first={t(`page.${id}.first`)}
      tip={def.tip ? t(`page.${id}.tip`) : undefined}
      dismissed={dismissed}
      onDismiss={() => hints.dismiss(id)}
      onRestore={() => hints.restore(id)}
      learnMoreHref={def.learnMore}
      learnMoreLabel={t('ui.learnMore')}
    />
  );
}

/**
 * Small "?" next to a heading, field, KPI or button. `id` is a key of TIP_HINTS.
 * Hidden when the user switched hints off.
 */
export function Hint({ id, className }: { id: TipHintId; className?: string }) {
  const t = useTranslations('hints');
  const hints = useHints();
  if (!hints.ready || !hints.enabled) return null;
  const def: { learnMore?: string } = TIP_HINTS[id];
  const title = t(`tip.${id}.title`);
  return (
    <HintTip
      title={title}
      label={t('ui.helpOn', { title })}
      closeLabel={t('ui.close')}
      learnMoreHref={def.learnMore}
      learnMoreLabel={t('ui.learnMore')}
      className={className}
    >
      <p>{t(`tip.${id}.body`)}</p>
    </HintTip>
  );
}

/** Chooses the hint for the current route (or an explicit `hintKey`) and renders it inside every PageHeader. */
function renderForRoute(pathname: string | null, hintKey?: string): React.ReactNode {
  const id =
    (hintKey && hintKey in PAGE_HINTS ? (hintKey as PageHintId) : null) ?? matchPageHint(pathname);
  return id ? <PageHintView id={id} /> : null;
}

export function RouteHintProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const render = React.useCallback(
    (hintKey?: string) => renderForRoute(pathname, hintKey),
    [pathname],
  );
  return <PageHintSlotProvider value={render}>{children}</PageHintSlotProvider>;
}

/** Top-bar switch: "Show hints" on/off. */
export function HintsToggle({ className }: { className?: string }) {
  const t = useTranslations('hints');
  const hints = useHints();
  const label = t('ui.showHints');
  return (
    <Tooltip label={hints.enabled ? t('ui.hintsOn') : t('ui.hintsOff')}>
      <button
        type="button"
        role="switch"
        aria-checked={hints.enabled}
        aria-label={label}
        onClick={hints.toggle}
        className={cn(
          'inline-flex size-10 items-center justify-center rounded-md hover:bg-ivory-200 focus-visible:outline-2 focus-visible:outline-focus',
          hints.enabled ? 'text-gold-700' : 'text-ink-500',
          className,
        )}
      >
        <Lightbulb
          aria-hidden="true"
          className={cn('size-[1.125rem]', hints.enabled && 'fill-gold-100')}
        />
      </button>
    </Tooltip>
  );
}
