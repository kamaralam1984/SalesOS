import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { cn } from '../lib/cn';
import { Card } from './card';
import { Skeleton } from './feedback';
import { PageHintSlot } from './hints';

/* ---------- AccentLine: animated rule (gold / blue / green / red / tricolor) ---------- */
export function AccentLine({
  tone = 'gold',
  animated = true,
  className,
}: {
  tone?: 'gold' | 'red' | 'blue' | 'green' | 'tricolor';
  animated?: boolean;
  className?: string;
}) {
  const cls = {
    gold: 'accent-line-gold',
    blue: 'accent-line-blue',
    green: 'accent-line-green',
    tricolor: 'accent-line-tricolor',
    red: 'accent-line bg-gradient-to-r from-red-600 to-red-600/10 after:hidden',
  }[tone];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'accent-line',
        cls,
        !animated && 'after:hidden [animation:none]',
        className,
      )}
    />
  );
}

/* ---------- Breadcrumbs ---------- */
export interface Crumb {
  label: React.ReactNode;
  href?: string;
}
export function Breadcrumbs({ items, label = 'Breadcrumb' }: { items: Crumb[]; label?: string }) {
  return (
    <nav aria-label={label} className="text-[0.8125rem]">
      <ol className="flex flex-wrap items-center gap-1 text-muted">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {c.href && !last ? (
                <Link href={c.href} className="rounded px-0.5 hover:text-ink hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn(last && 'font-medium text-ink')}
                >
                  {c.label}
                </span>
              )}
              {!last && <ChevronRight aria-hidden="true" className="size-3.5 text-ink-400" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------- PageHeader ---------- */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  breadcrumbs,
  className,
  breadcrumbLabel,
  hintKey,
  hint,
}: {
  /** Optional explicit hint key (otherwise the app's route-aware slot decides). */
  hintKey?: string;
  /** Explicit hint node rendered under the header (overrides the slot). */
  hint?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: Crumb[];
  breadcrumbLabel?: string;
  className?: string;
}) {
  return (
    <header className={cn('ui-anim-rise-in mb-6 md:mb-8', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="mb-2">
          <Breadcrumbs items={breadcrumbs} label={breadcrumbLabel} />
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow && (
            <p className="enter-fade mb-1 text-xs font-semibold tracking-[0.14em] text-gold-700 uppercase">
              {eyebrow}
            </p>
          )}
          <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight text-ink md:text-[2.25rem]">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <AccentLine tone="tricolor" className="mt-4 max-w-48" />
      {hint ?? <PageHintSlot hintKey={hintKey} />}
    </header>
  );
}

/* ---------- Stat / KPI tile ---------- */
export function Stat({
  label,
  value,
  hint,
  delta,
  deltaLabel,
  trend,
  accent = 'none',
  loading,
  icon,
  info,
  className,
}: {
  className?: string;
  /** Optional HintTip shown next to the label. */
  info?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** e.g. "+12%" - text is always shown with an icon + sr text, never colour only */
  delta?: string;
  deltaLabel?: string;
  trend?: 'up' | 'down' | 'flat';
  accent?: 'gold' | 'red' | 'blue' | 'green' | 'none';
  loading?: boolean;
  icon?: React.ReactNode;
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  return (
    <Card
      accent={accent}
      premium
      interactive
      className={cn(
        'flex flex-col gap-2',
        accent === 'gold' && 'shadow-[0_0_18px_-6px_rgb(184_146_58/0.35)]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[0.8125rem] font-medium text-muted">
          {label}
          {info}
        </p>
        {icon && (
          <span aria-hidden="true" className="text-ink-400 [&>svg]:size-4.5">
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-9 w-28" />
      ) : (
        <p className="kpi-number text-[2rem] text-ink">
          {value}
        </p>
      )}
      <div className="flex min-h-5 flex-wrap items-center gap-x-2 text-[0.8125rem] text-muted">
        {delta && (
          <span
            className={cn(
              'inline-flex items-center gap-1 font-medium',
              trend === 'down'
                ? 'text-red-700'
                : trend === 'up'
                  ? 'text-green-700'
                  : 'text-ink-600',
            )}
          >
            <TrendIcon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">
              {trend === 'down' ? 'Down' : trend === 'up' ? 'Up' : 'Unchanged'}:
            </span>
            {delta}
            {deltaLabel && <span className="sr-only"> {deltaLabel}</span>}
          </span>
        )}
        {hint && <span>{hint}</span>}
      </div>
    </Card>
  );
}

/* ---------- Avatar ---------- */
function initials(name: string) {
  const parts = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sz = { sm: 'size-7 text-[0.6875rem]', md: 'size-9 text-xs', lg: 'size-12 text-base' }[size];
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gold-50 font-semibold text-gold-700 ring-1 ring-gold-300/70',
        sz,
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}

/* ---------- Timeline (lead activity etc.) ---------- */
export interface TimelineItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Pre-formatted, human readable time. */
  time: React.ReactNode;
  /** ISO value for the <time> element. */
  dateTime?: string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'gold' | 'red' | 'blue' | 'green';
  meta?: React.ReactNode;
}
export function Timeline({ items, label }: { items: TimelineItem[]; label?: string }) {
  const dot = {
    neutral: 'bg-ivory-200 text-ink-600 ring-line-strong',
    gold: 'bg-gold-50 text-gold-700 ring-gold-300',
    red: 'bg-red-50 text-red-700 ring-red-100',
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    green: 'bg-green-50 text-green-700 ring-green-100',
  };
  return (
    <ol aria-label={label} className="relative space-y-5">
      {items.map((it, i) => (
        <li key={it.id} className="relative flex gap-3.5">
          {i < items.length - 1 && (
            <span
              aria-hidden="true"
              className="absolute top-8 bottom-[-1.25rem] left-[0.9375rem] w-px bg-line"
            />
          )}
          <span
            aria-hidden="true"
            className={cn(
              'z-10 inline-flex size-[1.875rem] shrink-0 items-center justify-center rounded-full ring-1 [&>svg]:size-4',
              dot[it.tone ?? 'neutral'],
            )}
          >
            {it.icon ?? <span className="size-1.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0 flex-1 pb-0.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium text-ink">{it.title}</p>
              <time dateTime={it.dateTime} className="text-xs text-muted">
                {it.time}
              </time>
            </div>
            {it.description && <p className="mt-0.5 text-sm text-ink-600">{it.description}</p>}
            {it.meta && <div className="mt-1.5">{it.meta}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Pipeline stage chips (no kanban) ---------- */
export interface StageChip {
  id: string;
  label: string;
  count?: number;
}
export function StageChips({
  stages,
  value,
  onChange,
  label = 'Pipeline stage',
}: {
  stages: StageChip[];
  value?: string;
  onChange?: (id: string) => void;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none]"
    >
      {stages.map((s, i) => {
        const active = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange?.(s.id)}
            className={cn(
              'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-[background-color,border-color,box-shadow] duration-200',
              active
                ? 'border-gold-500 bg-gradient-to-b from-gold-50 to-champagne-100 text-gold-700 shadow-sm'
                : 'border-line-strong bg-surface text-ink-700 hover:border-gold-400 hover:bg-champagne-100',
            )}
          >
            <span className="tabular text-xs text-muted" aria-hidden="true">
              {i + 1}
            </span>
            {s.label}
            {typeof s.count === 'number' && (
              <span className="tabular rounded-full bg-ivory-300 px-1.5 text-xs text-ink-700">
                {s.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
