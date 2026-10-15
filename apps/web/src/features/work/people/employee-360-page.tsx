'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Avatar, Badge, Breadcrumbs, Button, PageHeader, Panel } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState } from '@/features/people/hub/shared';
import { useAuth } from '@/features/auth/auth-provider';
import { HrProfileDialog } from '../hr/hr-profile-dialog';
import { useEmployee360, type Employee360 } from '@/lib/api/hooks/work-people';
import { attendanceTone, EmploymentStatus, NotVisible, ProgressBar, riskTone, useDates, useEnumLabel } from '../common';

export function Employee360Page({ id }: { id: string }) {
  return (
    <RequirePermission permission="directory:view">
      <Inner id={id} />
    </RequirePermission>
  );
}

function Inner({ id }: { id: string }) {
  const t = useTranslations('workPeople');
  const q = useEmployee360(id);
  const d = q.data;
  return (
    <>
      <Breadcrumbs label={t('p360.breadcrumb')} items={[{ label: t('directory.title'), href: '/work/directory' }, { label: d?.profile.available ? d.profile.name : t('p360.title') }]} />
      <QueryState query={q} isEmpty={!d} emptyTitle={t('p360.notFound')}>
        {d && <Body d={d} />}
      </QueryState>
    </>
  );
}

function Body({ d }: { d: Employee360 }) {
  const t = useTranslations('workPeople');
  const dates = useDates();
  const { can } = useAuth();
  const att = useEnumLabel('attendanceStatus');
  const risk = useEnumLabel('risk');
  const [editHr, setEditHr] = React.useState(false);
  const p = d.profile;
  return (
    <div className="mt-3">
      <PageHeader
        eyebrow={t('p360.eyebrow')}
        title={p.available ? p.name : t('p360.title')}
        description={p.available ? [p.designation, p.department].filter(Boolean).join(' · ') || undefined : undefined}
        actions={p.available ? <EmploymentStatus status={p.status} /> : undefined}
      />
      <div className="stagger grid gap-4 lg:grid-cols-2">
        <Panel title={t('p360.profile')}>
          {p.available ? (
            <div className="flex gap-4">
              <Avatar name={p.name} size="lg" />
              <dl className="grid flex-1 grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
                <Item k={t('p360.code')} v={p.employeeCode} />
                <Item k={t('p360.designation')} v={p.designation} />
                <Item k={t('p360.department')} v={p.department} />
                <Item k={t('p360.manager')} v={p.manager ? <Link className="text-blue-700 hover:underline" href={`/work/people/${p.manager.id}`}>{p.manager.name}</Link> : null} />
                <Item k={t('p360.joined')} v={p.joinDate ? dates.date(p.joinDate) : null} />
                <Item k={t('p360.location')} v={p.workLocation} />
                <Item k={t('p360.hrContact')} v={p.hrContact?.name} />
                <Item k={t('p360.email')} v={p.email} />
              </dl>
            </div>
          ) : <NotVisible />}
        </Panel>

        <Panel title={t('p360.hr')} actions={can('hr:records:manage') ? <Button size="sm" variant="secondary" onClick={() => setEditHr(true)}>{t('p360.hrOpen')}</Button> : undefined}>
          {d.hr.available ? (
            d.hr.hasProfile ? (
              <dl className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
                <Item k={t('p360.employmentType')} v={d.hr.employmentType} />
                <Item k={t('p360.joined')} v={d.hr.joinDate ? dates.date(d.hr.joinDate) : null} />
                <Item k={t('p360.exitDate')} v={d.hr.exitDate ? dates.date(d.hr.exitDate) : null} />
              </dl>
            ) : <p className="text-sm text-muted">{t('p360.noHrRecord')}</p>
          ) : <NotVisible />}
        </Panel>

        <Panel title={t('p360.probation')}>
          {d.probation.available ? (
            d.probation.hasData ? (
              <div className="space-y-2 text-sm">
                <Badge tone={d.probation.status === 'ON_PROBATION' ? 'gold' : 'green'}>{t(`p360.probationStatus.${d.probation.status}` as never)}</Badge>
                <p className="text-muted">{t('p360.probationDates', { start: dates.date(d.probation.startDate), end: dates.date(d.probation.endDate), months: d.probation.durationMonths ?? 0 })}</p>
                {d.probation.daysLeft !== null && <p className="text-ink">{t('p360.probationLeft', { n: d.probation.daysLeft })}</p>}
              </div>
            ) : <p className="text-sm text-muted">{t('p360.probationNone')}</p>
          ) : <NotVisible />}
        </Panel>

        <Panel title={t('p360.attendance')}>
          {d.attendance.available ? (
            d.attendance.hasData ? (
              <div className="space-y-3">
                <ul className="flex flex-wrap gap-2" aria-label={t('p360.attendanceMonth', { month: d.attendance.month })}>
                  {Object.entries(d.attendance.counts).map(([s, n]) => <li key={s}><Badge tone={attendanceTone(s)}>{att(s)}: {n}</Badge></li>)}
                </ul>
                <ul className="space-y-1 text-sm" aria-label={t('p360.attendanceRecent')}>
                  {d.attendance.recent.slice(0, 7).map((r) => <li key={r.id} className="flex justify-between gap-2"><span className="text-muted">{dates.date(r.date)}</span><span>{att(r.status)}</span></li>)}
                </ul>
              </div>
            ) : <p className="text-sm text-muted">{t('p360.attendanceNone')}</p>
          ) : <NotVisible />}
        </Panel>

        <Panel title={t('p360.leave')}>
          {d.leave.available ? (
            d.leave.hasData ? (
              <ul className="grid grid-cols-2 gap-2" aria-label={t('p360.leave')}>
                {d.leave.balances.map((b) => (
                  <li key={b.typeKey} className="rounded-lg border border-line bg-surface p-2.5">
                    <p className="text-xs text-muted">{b.name}</p>
                    <p className="text-lg font-semibold text-ink">{b.remaining}</p>
                    <p className="text-xs text-muted">{t('p360.leaveUsed', { used: b.used, pending: b.pending })}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">{t('p360.leaveNone')}</p>
          ) : <NotVisible />}
        </Panel>

        <Panel title={t('p360.performance')}>
          {d.performance.available ? (
            <div className="space-y-4">
              {d.performance.goals.available ? (
                d.performance.goals.hasData ? (
                  <ul className="space-y-2" aria-label={t('p360.goals')}>
                    {d.performance.goals.items.slice(0, 5).map((g) => (
                      <li key={g.id}>
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium text-ink">{g.title}</span><Badge tone={riskTone(g.risk)}>{risk(g.risk)}</Badge></div>
                        <ProgressBar pct={g.progressPct} label={t('p360.goalProgress', { title: g.title, pct: g.progressPct })} />
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">{t('p360.goalsNone')}</p>
              ) : <NotVisible label={t('p360.goalsHidden')} />}
              {d.performance.tasks.available ? (
                d.performance.tasks.hasData ? (
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <Item k={t('p360.tasksAssigned')} v={String(d.performance.tasks.assigned)} />
                    <Item k={t('p360.tasksDone')} v={String(d.performance.tasks.completed)} />
                    <Item k={t('p360.tasksOverdue')} v={String(d.performance.tasks.overdue)} />
                    <Item k={t('p360.tasksRate')} v={d.performance.tasks.completionRatePct === null ? '—' : `${d.performance.tasks.completionRatePct}%`} />
                  </dl>
                ) : <p className="text-sm text-muted">{t('p360.tasksNone')}</p>
              ) : <NotVisible label={t('p360.tasksHidden')} />}
            </div>
          ) : <NotVisible />}
        </Panel>

        <Panel title={t('p360.activity')}>
          {d.activity.available ? (
            d.activity.hasData ? (
              <ul className="space-y-1.5 text-sm" aria-label={t('p360.activity')}>
                {d.activity.items.map((a) => (
                  <li key={`${a.source}-${a.id}`} className="flex justify-between gap-2">
                    <Link href={a.source === 'goal' ? `/work/goals/${a.entityId}` : `/work/tasks/${a.entityId}`} className="truncate text-ink hover:underline">{a.title}</Link>
                    <span className="shrink-0 text-muted">{dates.date(a.at)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">{t('p360.activityNone')}</p>
          ) : <NotVisible />}
        </Panel>
      </div>
      {editHr && p.available && <HrProfileDialog userId={d.id} name={p.name} open onOpenChange={setEditHr} />}
    </div>
  );
}

function Item({ k, v }: { k: string; v?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="text-ink">{v || '—'}</dd>
    </div>
  );
}
