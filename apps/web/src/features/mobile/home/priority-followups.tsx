'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, CircleDot, Hourglass, Phone, XCircle, type LucideIcon } from 'lucide-react';
import { Skeleton } from '@salesos/ui';
import { useLeadMeta, useTasks, type CrmTask, type StageCategory } from '@/lib/api/hooks/crm';
import { DispositionDialog } from '@/features/crm/disposition-dialog';
import { markPendingCall } from '@/features/crm/pending-call';
import { initials, toTel } from '@/features/crm/lib';
import { useCrmFormat, useStageLabel } from '@/features/crm/common';

const MAX_ROWS = 4;
const CHIP: Record<StageCategory, { cls: string; Icon: LucideIcon }> = {
  OPEN: { cls: 'border-blue-500/40 bg-blue-500/10 text-blue-600', Icon: CircleDot },
  NURTURE: { cls: 'border-gold-500/40 bg-gold-500/10 text-gold-600', Icon: Hourglass },
  WON: { cls: 'border-green-500/40 bg-green-500/10 text-green-600', Icon: CheckCircle2 },
  LOST: { cls: 'border-line bg-surface text-muted', Icon: XCircle },
};

const istDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

function dueSort(a: CrmTask, b: CrmTask) {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}

export function PriorityFollowUps() {
  const t = useTranslations('mobileFollowUps');
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
    return istDayFmt.format(new Date(task.dueAt)) === today ? t('today', { time }) : t('due', { when: f.dateTime(task.dueAt) });
  };

  return (
    <section aria-label={t('title')}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">{t('title')}</h2>
        <Link href="/m/calls" className="inline-flex min-h-11 items-center text-sm font-medium text-gold-500 underline-offset-4 hover:underline">{t('viewAll')}</Link>
      </div>
      {q.isLoading ? (
        <div aria-busy="true" className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[68px] w-full rounded-2xl" />)}</div>
      ) : q.isError ? (
        <div role="alert" className="rounded-2xl border border-line bg-surface p-4 text-sm">
          <p className="text-red-700">{t('error')}</p>
          <button type="button" onClick={() => void q.refetch()} className="mt-2 inline-flex min-h-11 items-center font-medium text-gold-500 underline-offset-4 hover:underline">{t('retry')}</button>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">{t('empty')}</p>
      ) : (
        <ul className="stagger space-y-2">
          {rows.map((task) => {
            const lead = task.lead;
            if (!lead) return null;
            const phone = lead.phone;
            const href = toTel(phone);
            const cat = meta.data?.stages.find((s) => s.key === lead.status)?.category ?? 'OPEN';
            const { cls, Icon } = CHIP[cat];
            return (
              <li key={task.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
                <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gold-500/15 text-sm font-semibold text-gold-500">{initials(lead.fullName)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{lead.fullName}</p>
                  <p className={`flex items-center gap-1 text-sm ${task.overdue ? 'font-medium text-red-700' : 'text-muted'}`}>
                    {task.overdue && <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />}
                    {task.overdue ? `${dueText(task)} · ${f.time(task.dueAt)}` : dueText(task)}
                  </p>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
                  <Icon className="size-3" aria-hidden="true" />{stageLabel(lead.status)}
                </span>
                {href ? (
                  <a
                    href={href}
                    aria-label={t('call', { name: lead.fullName })}
                    onClick={() => {
                      markPendingCall({ leadId: lead.id, name: lead.fullName, phone });
                      setTarget({ id: lead.id, fullName: lead.fullName, phone: phone ?? null });
                    }}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-gold-500 text-gold-500 hover:bg-gold-500/10"
                  >
                    <Phone className="size-5" aria-hidden="true" />
                  </a>
                ) : (
                  <span role="img" aria-label={t('noPhone')} title={t('noPhone')} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line text-muted opacity-50">
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
