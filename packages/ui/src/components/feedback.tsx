import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Info,
  Lock,
  OctagonAlert,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './button';

/* ---------- Badge ---------- */
export type Tone = 'neutral' | 'gold' | 'red' | 'blue' | 'green';

const toneClasses: Record<Tone, string> = {
  neutral: 'border-line-strong bg-ivory-200 text-ink-700',
  gold: 'border-gold-300 bg-gradient-to-b from-gold-50 to-champagne-100 text-gold-700',
  red: 'border-red-100 bg-red-50 text-red-700',
  blue: 'border-blue-100 bg-blue-50 text-blue-700',
  green: 'border-green-600/25 bg-gradient-to-b from-green-50 to-green-100/70 text-green-700',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  icon?: React.ReactNode;
}

export function Badge({ tone = 'neutral', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'enter-fade inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-5 whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
      {...rest}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-3.5">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

/* ---------- StatusBadge: always icon + text, never colour alone ---------- */
export type Status = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'pending' | 'overdue';

const statusMeta: Record<
  Status,
  { tone: Tone; Icon: React.ComponentType<{ className?: string }> }
> = {
  success: { tone: 'green', Icon: CheckCircle2 },
  warning: { tone: 'gold', Icon: AlertTriangle },
  danger: { tone: 'red', Icon: XCircle },
  overdue: { tone: 'red', Icon: Clock3 },
  info: { tone: 'blue', Icon: Info },
  pending: { tone: 'gold', Icon: CircleDashed },
  neutral: { tone: 'neutral', Icon: CircleDashed },
};

export function StatusBadge({
  status,
  children,
  className,
}: {
  status: Status;
  /** Text label is mandatory: status is never colour-only. */
  children: React.ReactNode;
  className?: string;
}) {
  const { tone, Icon } = statusMeta[status];
  return (
    <Badge tone={tone} icon={<Icon />} className={className} data-status={status}>
      {children}
    </Badge>
  );
}

/* ---------- Skeleton ---------- */
export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('ui-skeleton shimmer rounded-md', className)} {...rest} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

/** Wrapper that announces a loading region to assistive tech. */
export function LoadingRegion({
  label = 'Loading',
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/* ---------- State panels ---------- */
interface StateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  headingLevel?: 1 | 2 | 3;
  compact?: boolean;
}

function StateShell({
  tone,
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  headingLevel = 2,
  compact,
  role,
  children,
}: StateProps & {
  tone: 'neutral' | 'red' | 'gold' | 'blue';
  role?: 'alert' | 'status';
  children?: React.ReactNode;
}) {
  const H = `h${headingLevel}` as 'h2';
  const ring = {
    neutral: 'bg-ivory-200 text-ink-600 ring-line-strong',
    red: 'bg-red-50 text-red-700 ring-red-100',
    gold: 'bg-gold-50 text-gold-700 ring-gold-100',
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
  }[tone];
  /* Only the friendly gold empty state breathes (slow 5s, soft); errors and neutral states stay still. */
  const halo = tone === 'gold' ? 'glow-pulse' : '';
  return (
    <div
      role={role}
      className={cn(
        'enter-up mx-auto flex max-w-md flex-col items-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <span
        className={cn(
          'ui-anim-rise-in mb-4 inline-flex size-12 items-center justify-center rounded-full shadow-sm ring-1 [&>svg]:size-6',
          ring,
          halo,
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <H className="font-display text-xl font-semibold text-ink">{title}</H>
      {description && <p className="mt-1.5 text-sm leading-relaxed text-muted">{description}</p>}
      {children}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon, ...props }: StateProps) {
  return <StateShell tone="neutral" icon={icon ?? <CircleDashed />} {...props} />;
}

export interface ErrorStateProps extends Omit<StateProps, 'title'> {
  title?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** Request / correlation id shown to help support. */
  requestId?: string;
  requestIdLabel?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'We could not load this. Check your connection and try again.',
  onRetry,
  retryLabel = 'Try again',
  requestId,
  requestIdLabel = 'Reference',
  action,
  ...props
}: ErrorStateProps) {
  return (
    <StateShell
      tone="red"
      role="alert"
      icon={<OctagonAlert />}
      title={title}
      description={description}
      action={
        action ??
        (onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined)
      }
      {...props}
    >
      {requestId && (
        <p className="mt-3 text-xs text-muted">
          {requestIdLabel}:{' '}
          <code className="rounded bg-ivory-200 px-1.5 py-0.5 font-mono">{requestId}</code>
        </p>
      )}
    </StateShell>
  );
}

export function PermissionDenied({
  title = 'You do not have access to this area',
  description = 'Your role does not include this permission. If you think this is a mistake, ask an administrator.',
  action,
  ...props
}: Partial<StateProps>) {
  return (
    <StateShell
      tone="gold"
      role="alert"
      icon={<Lock />}
      title={title}
      description={description}
      action={action}
      {...props}
    />
  );
}

/* ---------- Inline Alert / Banner ---------- */
export type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const alertMeta: Record<
  AlertTone,
  { cls: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  info: { cls: 'border-blue-100 bg-blue-50 text-blue-700', Icon: Info },
  success: { cls: 'border-green-600/25 bg-green-50 text-green-700', Icon: CheckCircle2 },
  warning: { cls: 'border-gold-300 bg-gold-50 text-gold-700', Icon: ShieldAlert },
  danger: { cls: 'border-red-100 bg-red-50 text-red-700', Icon: OctagonAlert },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  actions,
  live = true,
}: {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  live?: boolean;
}) {
  const { cls, Icon } = alertMeta[tone];
  return (
    <div
      role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}
      className={cn('enter-up flex items-start gap-3 rounded-md border px-3.5 py-3 text-sm', cls, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-ink-700')}>{children}</div>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
