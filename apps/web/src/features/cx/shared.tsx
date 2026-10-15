'use client';
import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';
import { Alert, Badge, Button, Dialog, DialogContent, ErrorState, FormField, Skeleton, StatusBadge, Textarea, type PaginationProps } from '@salesos/ui';
import { useApiErrorMessage } from '@/hooks/use-api-error';

export function useFmt() {
  const locale = useLocale();
  return React.useMemo(() => {
    const loc = locale === 'en' ? 'en-IN' : locale;
    const d = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
    const dt = new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
    const num = new Intl.NumberFormat(loc, { maximumFractionDigits: 2 });
    return {
      date: (v?: string | null) => (v ? d.format(new Date(v.length === 10 ? `${v}T00:00:00Z` : v)) : '—'),
      dateTime: (v?: string | null) => (v ? dt.format(new Date(v)) : '—'),
      money: (amount?: string | null, currency = 'INR') => (amount == null ? '—' : `${currency} ${num.format(Number(amount))}`),
    };
  }, [locale]);
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function usePaginationLabels(): NonNullable<PaginationProps['labels']> {
  const tc = useTranslations('common');
  return {
    nav: tc('pagination'),
    previous: tc('previous'),
    next: tc('next'),
    summary: (from, to, total) => tc('paginationSummary', { from, to, total }),
    page: (p, c) => tc('paginationPage', { page: p, count: c }),
    pageOnly: (p) => tc('paginationPageOnly', { page: p }),
  };
}

type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'pending' | 'overdue';

const COMPLAINT_TONE: Record<string, StatusTone> = { OPEN: 'pending', ACKNOWLEDGED: 'info', IN_PROGRESS: 'info', ESCALATED: 'danger', RESOLVED: 'success', CLOSED: 'neutral', REOPENED: 'warning' };
const WORK_TONE: Record<string, StatusTone> = { OPEN: 'pending', IN_PROGRESS: 'info', COMPLETED: 'success', OVERDUE: 'overdue', ESCALATED: 'danger', CANCELLED: 'neutral' };
const HANDOVER_TONE: Record<string, StatusTone> = { DRAFT: 'neutral', SUBMITTED: 'pending', INFO_REQUESTED: 'warning', ACKNOWLEDGED: 'info', OVERDUE: 'overdue', COMPLETED: 'success' };
const ESC_TONE: Record<string, StatusTone> = { OPEN: 'pending', IN_REVIEW: 'info', RESOLVED: 'success', CANCELLED: 'neutral' };

export function ComplaintStatusBadge({ status }: { status: string }) {
  const t = useTranslations('cx.complaintStatus');
  return <StatusBadge status={COMPLAINT_TONE[status] ?? 'neutral'}>{t(status as never)}</StatusBadge>;
}
export function WorkStatusBadge({ status }: { status: string }) {
  const t = useTranslations('cx.workStatus');
  return <StatusBadge status={WORK_TONE[status] ?? 'neutral'}>{t(status as never)}</StatusBadge>;
}
export function HandoverStatusBadge({ status }: { status: string }) {
  const t = useTranslations('cx.handoverStatus');
  return <StatusBadge status={HANDOVER_TONE[status] ?? 'neutral'}>{t(status as never)}</StatusBadge>;
}
export function EscalationStatusBadge({ status }: { status: string }) {
  const t = useTranslations('cx.escalationStatus');
  return <StatusBadge status={ESC_TONE[status] ?? 'neutral'}>{t(status as never)}</StatusBadge>;
}
export function PriorityBadge({ priority }: { priority: string }) {
  const t = useTranslations('cx.priority');
  const tone = priority === 'P1' ? 'red' : priority === 'P2' ? 'gold' : priority === 'P3' ? 'blue' : 'neutral';
  return <Badge tone={tone}>{t(priority as never)}</Badge>;
}

/** Remaining-time label. Negative = breached. Hours/minutes only (business-hour deadlines are absolute instants server-side). */
export function formatRemaining(ms: number, t: (k: 'min' | 'hours' | 'days', v: { n: number }) => string): string {
  const abs = Math.abs(ms);
  const mins = Math.max(1, Math.round(abs / 60_000));
  if (mins < 120) return t('min', { n: mins });
  const hours = Math.round(abs / 3_600_000);
  if (hours < 48) return t('hours', { n: hours });
  return t('days', { n: Math.round(abs / 86_400_000) });
}

/**
 * SLA countdown for a deadline. Ticks once a minute. Colour is never the only signal: icon + text ("Due in 3 h" / "Breached 2 h ago").
 * `done` freezes the badge ("Met" / "Missed").
 */
export function SlaCountdown({ dueAt, breachedAt, stoppedLabel, label }: { dueAt: string; breachedAt?: string | null; stoppedLabel?: string; label: string }) {
  const t = useTranslations('cx.sla');
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (stoppedLabel) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [stoppedLabel]);
  if (stoppedLabel) {
    return <span className="inline-flex items-center gap-1 text-sm text-muted"><CheckCircle2 className="size-4 text-green-700" aria-hidden="true" />{label}: {stoppedLabel}</span>;
  }
  const ms = new Date(dueAt).getTime() - now;
  const breached = ms < 0 || Boolean(breachedAt);
  const soon = !breached && ms < 2 * 3_600_000;
  const text = breached ? t('breached', { time: formatRemaining(ms, (k, v) => t(`unit.${k}` as never, v as never)) }) : t('dueIn', { time: formatRemaining(ms, (k, v) => t(`unit.${k}` as never, v as never)) });
  const Icon = breached ? AlertTriangle : Clock3;
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${breached ? 'text-red-700' : soon ? 'text-gold-700' : 'text-ink-700'}`} data-breached={breached ? 'true' : 'false'}>
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only">{label}: </span>
      {text}
    </span>
  );
}

/** Single-textarea (and optional extra fields) confirmation dialog used for state transitions that need a note/reason. */
export function NoteDialog({
  open, onOpenChange, title, description, label, required = true, submitLabel, onSubmit, pending, error, children, hint,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; label: string; required?: boolean; submitLabel: string;
  onSubmit: (note: string) => void; pending?: boolean; error?: unknown; children?: React.ReactNode; hint?: string;
}) {
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} closeLabel={tc('close')}>
        {open && <NoteForm label={label} required={required} submitLabel={submitLabel} onSubmit={onSubmit} onCancel={() => onOpenChange(false)} pending={pending} error={error ? apiErr(error).message : undefined} hint={hint}>{children}</NoteForm>}
      </DialogContent>
    </Dialog>
  );
}

function NoteForm({ label, required, submitLabel, onSubmit, onCancel, pending, error, children, hint }: { label: string; required: boolean; submitLabel: string; onSubmit: (note: string) => void; onCancel: () => void; pending?: boolean; error?: string; children?: React.ReactNode; hint?: string }) {
  const tc = useTranslations('common');
  const [note, setNote] = React.useState('');
  const missing = required && note.trim().length < 3;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!missing) onSubmit(note.trim()); }}>
      {error && <Alert tone="danger">{error}</Alert>}
      {children}
      <FormField label={label} required={required} hint={hint}>
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </FormField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>{tc('cancel')}</Button>
        <Button type="submit" loading={pending} disabled={missing}>{submitLabel}</Button>
      </div>
    </form>
  );
}

export function HistoryList({ items }: { items: Array<{ from: string | null; to: string; actorName: string | null; note: string | null; at: string }> }) {
  const fmt = useFmt();
  const t = useTranslations('cx.common');
  if (!items.length) return <p className="text-sm text-muted">{t('noHistory')}</p>;
  return (
    <ol className="space-y-3" aria-label={t('history')}>
      {items.map((h, i) => (
        <li key={`${h.at}-${i}`} className="border-l-2 border-line pl-3">
          <p className="text-sm font-medium text-ink">{h.from && h.from !== h.to ? `${h.from} → ${h.to}` : h.to}</p>
          <p className="text-xs text-muted">{fmt.dateTime(h.at)} · {h.actorName ?? t('system')}</p>
          {h.note && <p className="mt-0.5 text-sm text-ink-700">{h.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/** Wrapper for the page-level query states so every page handles loading / error / empty the same way. */
export function ListShell({ query, skeletons = 4, children, empty }: { query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; skeletons?: number; children: React.ReactNode; empty?: React.ReactNode }) {
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  if (query.isPending) {
    return <div className="grid gap-3" aria-busy="true" aria-label={tc('loading')}>{Array.from({ length: skeletons }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>;
  }
  if (query.isError) return <ErrorState description={apiErr(query.error).message} requestId={apiErr(query.error).requestId} onRetry={() => query.refetch()} retryLabel={tc('retry')} />;
  return <>{empty ?? children}</>;
}

export const toInputDateTime = (offsetHours: number) => {
  const d = new Date(Date.now() + offsetHours * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const inputToIso = (v: string) => new Date(v).toISOString();
