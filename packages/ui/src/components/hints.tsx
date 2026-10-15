'use client';
import * as React from 'react';
import Link from 'next/link';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ChevronDown, CircleHelp, Lightbulb, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { Popover, PopoverContent, PopoverTrigger } from './overlays';

/* ---------- HintTip: small "?" button that opens an accessible popover ---------- */
export interface HintTipProps {
  /** Short heading of the hint; also used for the button's accessible name. */
  title: string;
  /** One to three short lines. */
  children: React.ReactNode;
  /** Accessible name of the button. Defaults to `Help: <title>`. */
  label?: string;
  learnMoreHref?: string;
  learnMoreLabel?: string;
  closeLabel?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export function HintTip({
  title,
  children,
  label,
  learnMoreHref,
  learnMoreLabel = 'Learn more',
  closeLabel = 'Close',
  side = 'bottom',
  className,
}: HintTipProps) {
  const uid = React.useId();
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ?? `Help: ${title}`}
          data-hint-tip=""
          className={cn(
            // 24px visual target, 44px touch target through the pseudo element
            'relative inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle text-blue-700 transition-colors',
            'hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
            'after:absolute after:-inset-2.5 after:content-[""] md:after:-inset-1',
            className,
          )}
        >
          <CircleHelp aria-hidden="true" className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-72 max-w-[calc(100vw-2rem)] border-blue-100 text-sm"
      >
        <div className="flex items-start justify-between gap-2">
          <p id={titleId} className="font-semibold text-ink">
            {title}
          </p>
          <PopoverCloseButton label={closeLabel} />
        </div>
        <div id={bodyId} className="mt-1 space-y-1 text-[0.8125rem] leading-relaxed text-ink-700">
          {children}
        </div>
        {learnMoreHref && (
          <Link
            href={learnMoreHref}
            className="mt-2 inline-block text-[0.8125rem] font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            {learnMoreLabel}
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PopoverCloseButton({ label }: { label: string }) {
  return (
    <PopoverCloseImpl
      aria-label={label}
      className="-mt-1 -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-ivory-200 hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
    >
      <X aria-hidden="true" className="size-4" />
    </PopoverCloseImpl>
  );
}
const PopoverCloseImpl = PopoverPrimitive.Close;

/* ---------- PageHint: dismissible, collapsible "about this page" card ---------- */
export interface PageHintLabels {
  /** Heading, e.g. "About this page". */
  title: string;
  whatLabel: string;
  firstLabel: string;
  tipLabel: string;
  collapse: string;
  expand: string;
  dismiss: string;
  /** Button shown after dismissing, to bring the tips back for this page. */
  restore: string;
}
export interface PageHintProps {
  labels: PageHintLabels;
  what: React.ReactNode;
  first?: React.ReactNode;
  tip?: React.ReactNode;
  dismissed?: boolean;
  onDismiss?: () => void;
  onRestore?: () => void;
  /** Start collapsed (the user can still expand). */
  defaultCollapsed?: boolean;
  learnMoreHref?: string;
  learnMoreLabel?: string;
  className?: string;
}

export function PageHint({
  labels,
  what,
  first,
  tip,
  dismissed = false,
  onDismiss,
  onRestore,
  defaultCollapsed = false,
  learnMoreHref,
  learnMoreLabel = 'Learn more',
  className,
}: PageHintProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const uid = React.useId();
  const bodyId = `${uid}-body`;
  const headId = `${uid}-head`;
  if (dismissed) {
    return (
      <div className={cn('mt-3', className)}>
        <button
          type="button"
          onClick={onRestore}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-[0.8125rem] font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <CircleHelp aria-hidden="true" className="size-4" />
          {labels.restore}
        </button>
      </div>
    );
  }
  return (
    <section
      aria-labelledby={headId}
      data-page-hint=""
      className={cn(
        'relative mt-4 rounded-lg border border-blue-100 bg-gradient-to-b from-blue-50/70 to-surface px-4 py-3 shadow-xs',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Lightbulb aria-hidden="true" className="size-4 shrink-0 text-gold-700" />
        <h2 id={headId} className="min-w-0 flex-1 text-sm font-semibold text-ink">
          {labels.title}
        </h2>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? labels.expand : labels.collapse}
          onClick={() => setCollapsed((v) => !v)}
          className="inline-flex size-8 items-center justify-center rounded-md text-ink-600 hover:bg-ivory-200 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn('size-4 transition-transform duration-200', !collapsed && 'rotate-180')}
          />
        </button>
        {onDismiss && (
          <button
            type="button"
            aria-label={labels.dismiss}
            onClick={onDismiss}
            className="inline-flex size-8 items-center justify-center rounded-md text-ink-600 hover:bg-ivory-200 focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      <div id={bodyId} hidden={collapsed} className="mt-2 space-y-2 text-sm text-ink-700">
        <p>{what}</p>
        {first && (
          <p>
            <span className="font-semibold text-ink">{labels.firstLabel}: </span>
            {first}
          </p>
        )}
        {tip && (
          <p>
            <span className="font-semibold text-ink">{labels.tipLabel}: </span>
            {tip}
          </p>
        )}
        {learnMoreHref && (
          <Link
            href={learnMoreHref}
            className="inline-block text-[0.8125rem] font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            {learnMoreLabel}
          </Link>
        )}
      </div>
    </section>
  );
}

/* ---------- Slot: lets the app inject a route-aware PageHint into every PageHeader ---------- */
export type PageHintRenderer = (hintKey?: string) => React.ReactNode;
const PageHintSlotContext = React.createContext<PageHintRenderer | null>(null);
export const PageHintSlotProvider = PageHintSlotContext.Provider;
export function PageHintSlot({ hintKey }: { hintKey?: string }) {
  const render = React.useContext(PageHintSlotContext);
  return render ? <>{render(hintKey)}</> : null;
}
