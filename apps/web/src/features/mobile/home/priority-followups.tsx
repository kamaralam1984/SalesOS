'use client';
import * as React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Check, ChevronRight, Clock, Phone, Star, XCircle, type LucideIcon } from 'lucide-react';
import { Skeleton } from '@salesos/ui';
import { useLeadMeta, useTasks, type CrmTask, type StageCategory } from '@/lib/api/hooks/crm';
import { DispositionDialog } from '@/features/crm/disposition-dialog';
import { markPendingCall } from '@/features/crm/pending-call';
import { initials, toTel } from '@/features/crm/lib';
import { useCrmFormat, useStageLabel } from '@/features/crm/common';

const MAX_ROWS = 3;
const CHIP: Record<StageCategory, { cls: string; Icon: LucideIcon }> = {
  OPEN: { cls: 'border-blue-500/50 text-blue-700', Icon: Check },
  NURTURE: { cls: 'border-gold-500/50 text-gold-700', Icon: Clock },
  WON: { cls: 'border-green-500/50 text-green-700', Icon: Star },
  LOST: { cls: 'border-line text-muted', Icon: XCircle },
};

const istDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

function dueSort(a: CrmTask, b: CrmTask) {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}

export function PriorityFollowUps() {
  const t = useTranslations('mobileFollowUps');
  const locale = useLocale();
  const f = useCrmFormat();
  const stageLabel = useStageLabel();
  const meta = useLeadMeta();
  const q = useTasks({ status: 'OPEN', mine: true, page: 1, limit: 20 });
  const [target, setTarget] = React.useState<{ id: string; fullName: string; phone: string | null } | null>(null);
  const [now] = React.useState(() => Date.now());

  const rows = React.useMemo(
    () => (q.data?.items ?? []).filter((x) => x.status === 'OPEN' && x.lead).sort(dueSort).slice(0, MAX_ROWS),
    [q.data],
  );
  const today = istDayFmt.format(new Date(now));
  const dueText = (task: CrmTask) => {
    const time = f.time(task.dueAt);
    if (task.overdue) return t('overdue');
    if (istDayFmt.format(new Date(task.dueAt)) === today) return t('today', { time });
    // short "16 Oct, 2:00 pm" (no year) so a later due date never truncates on a 360px phone
    const when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(task.dueAt));
    return t('due', { when });
  };

  const card = 'overflow-hidden rounded-2xl border border-gold-500/30 bg-surface shadow-sm';
  return (
    <section aria-label={t('title')}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">{t('title')}</h2>
        <Link href="/m/calls" className="inline-flex min-h-11 items-center gap-0.5 text-sm font-medium text-gold-700 underline-offset-4 hover:underline">
          {t('viewAll')}<ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </div>
      {q.isLoading ? (
        <div aria-busy="true" className={`${card} divide-y divide-gold-500/20`}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex h-[72px] items-center gap-3 px-3">
              <Skeleton className="size-11 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>
              <Skeleton className="size-11 shrink-0 rounded-xl" />
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <div role="alert" className={`${card} p-4 text-sm`}>
          <p className="text-red-700">{t('error')}</p>
          <button type="button" onClick={() => void q.refetch()} className="mt-2 inline-flex min-h-11 items-center font-medium text-gold-700 underline-offset-4 hover:underline">{t('retry')}</button>
        </div>
      ) : rows.length === 0 ? (
        <p className={`${card} p-4 text-sm text-muted`}>{t('empty')}</p>
      ) : (
        <ul className={`${card} divide-y divide-gold-500/20`}>
          {rows.map((task) => {
            const lead = task.lead;
            if (!lead) return null;
            const phone = lead.phone;
            const href = toTel(phone);
            const cat = meta.data?.stages.find((s) => s.key === lead.status)?.category ?? 'OPEN';
            const { cls, Icon } = CHIP[cat];
            const isToday = !task.overdue && istDayFmt.format(new Date(task.dueAt)) === today;
            const dueCls = task.overdue ? 'font-medium text-red-700' : isToday ? 'text-blue-700' : 'text-gold-700';
            return (
              <li key={task.id} className="flex min-h-[72px] items-center gap-3 px-3 py-2">
                <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gold-500/10 text-sm font-semibold text-gold-700 ring-1 ring-gold-500/40">{initials(lead.fullName)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{lead.fullName}</p>
                  <p className={`flex items-center gap-1 text-sm ${dueCls}`}>
                    {task.overdue && <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />}
                    <span className="truncate">{dueText(task)}</span>
                  </p>
                </div>
                <span className={`inline-flex max-w-[34%] shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>
                  <Icon className="size-3 shrink-0" aria-hidden="true" /><span className="truncate">{stageLabel(lead.status)}</span>
                </span>
                {href ? (
                  <a
                    href={href}
                    aria-label={t('call', { name: lead.fullName })}
                    onClick={() => {
                      markPendingCall({ leadId: lead.id, name: lead.fullName, phone });
                      setTarget({ id: lead.id, fullName: lead.fullName, phone: phone ?? null });
                    }}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-gold-600 text-gold-700 hover:bg-gold-500/10"
                  >
                    <Phone className="size-5" aria-hidden="true" />
                  </a>
                ) : (
                  <span role="img" aria-label={t('noPhone')} title={t('noPhone')} className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-line text-muted opacity-50">
                    <Phone className="size-5" aria-hidden="true" />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {target && (
        <DispositionDialog
          open
          onOpenChange={(o) => { if (!o) setTarget(null); }}
          lead={target}
          taskId={rows.find((r) => r.lead?.id === target.id)?.id}
          prompt={t('prompt', { name: target.fullName })}
        />
      )}
    </section>
  );
}
