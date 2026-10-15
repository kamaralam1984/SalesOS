'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, PageHeader, Panel, Stat } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState } from '@/features/people/hub/shared';
import { useWorkDashboard, type WorkDashboard } from '@/lib/api/hooks/work-people';
import { attendanceTone, ProgressBar, riskTone, useDates, useEnumLabel } from '../common';

export function WorkHubPage() {
  return (
    <RequirePermission permission="workforce:dashboard:view">
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const t = useTranslations('workPeople');
  const q = useWorkDashboard();
  const d = q.data;
  const dates = useDates();
  return (
    <>
      <PageHeader eyebrow={t('hub.eyebrow')} title={t('hub.title')} description={d ? t(`hub.description.${d.scopeLevel}` as never) : t('hub.description.own')} actions={d ? <span className="text-sm text-muted">{t('hub.asOf', { date: dates.date(d.today) })}</span> : undefined} />
      <QueryState query={q} isEmpty={!d} emptyTitle={t('hub.empty')}>
        {d && (
          <div className="enter-up space-y-8">
            {d.organisation && <OrganisationBlock org={d.organisation} />}
            {d.team && <TeamBlock team={d.team} />}
            <EmployeeBlock e={d.employee} />
          </div>
        )}
      </QueryState>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted">{text}</p>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 font-display text-xl font-semibold text-ink">{children}</h2>;
}

/* ------------------------------------------------------------ employee */
function EmployeeBlock({ e }: { e: WorkDashboard['employee'] }) {
  const t = useTranslations('workPeople');
  const dates = useDates();
  const att = useEnumLabel('attendanceStatus');
  const dayKind = useEnumLabel('dayKind');
  const risk = useEnumLabel('risk');
  const taskStatus = useEnumLabel('taskStatus');
  return (
    <section aria-labelledby="hub-me">
      <h2 id="hub-me" className="mb-3 font-display text-xl font-semibold text-ink">{t('hub.me')}</h2>
      <div className="stagger grid gap-4 lg:grid-cols-2">
        {e.announcements.available && (
          <Panel title={t('hub.announcements.title')} className="lg:col-span-2">
            {e.announcements.hasData ? (
              <ul className="space-y-3" aria-label={t('hub.announcements.title')}>
                {e.announcements.items.map((a) => (
                  <li key={a.id} className="hover-lift rounded-lg border border-line bg-surface p-3">
                    <p className="font-medium text-ink">{a.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{a.body}</p>
                    <p className="mt-1 text-xs text-muted">{dates.date(a.publishedAt)}{a.expiresAt ? ` · ${t('hub.announcements.until', { date: dates.date(a.expiresAt) })}` : ''}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty text={t('hub.announcements.empty')} />}
          </Panel>
        )}
        {e.attendance.available && (
          <Panel title={t('hub.attendance.title')} actions={<Link className="text-sm text-blue-700 underline" href="/work/attendance">{t('hub.attendance.open')}</Link>}>
            {e.attendance.record ? (
              <div className="space-y-1">
                <Badge tone={attendanceTone(e.attendance.record.status)}>{att(e.attendance.record.status)}</Badge>
                <p className="text-sm text-muted">{t('hub.attendance.times', { in: dates.time(e.attendance.record.checkInAt), out: e.attendance.record.checkOutAt ? dates.time(e.attendance.record.checkOutAt) : '—' })}</p>
              </div>
            ) : e.attendance.dayKind !== 'WORKING' ? (
              <Empty text={e.attendance.holidayName ? t('hub.attendance.holiday', { name: e.attendance.holidayName }) : dayKind(e.attendance.dayKind)} />
            ) : <Empty text={t('hub.attendance.notMarked')} />}
          </Panel>
        )}
        {e.tasks.available && (
          <Panel title={t('hub.tasks.title')} actions={<Link className="text-sm text-blue-700 underline" href="/work/tasks">{t('hub.tasks.open')}</Link>}>
            {e.tasks.hasData ? (
              <>
                <p className="mb-2 text-sm text-muted">{t('hub.tasks.summary', { open: e.tasks.open, overdue: e.tasks.overdue, today: e.tasks.dueToday })}</p>
                <ul className="space-y-2" aria-label={t('hub.tasks.title')}>
                  {e.tasks.items.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <Link href={`/work/tasks/${x.id}`} className="font-medium text-ink hover:underline">{x.title}</Link>
                      <span className="flex items-center gap-2">
                        {x.overdue && <Badge tone="red">{t('hub.tasks.overdue')}</Badge>}
                        <Badge tone="neutral">{taskStatus(x.status)}</Badge>
                        <span className="text-xs text-muted">{x.dueAt ? dates.date(x.dueAt) : ''}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : <Empty text={t('hub.tasks.empty')} />}
          </Panel>
        )}
        {e.goals.available && (
          <Panel title={t('hub.goals.title')} actions={<Link className="text-sm text-blue-700 underline" href="/work/goals">{t('hub.goals.open')}</Link>}>
            {e.goals.hasData ? (
              <ul className="space-y-3" aria-label={t('hub.goals.title')}>
                {e.goals.items.map((g) => (
                  <li key={g.id}>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/work/goals/${g.id}`} className="text-sm font-medium text-ink hover:underline">{g.title}</Link>
                      <Badge tone={riskTone(g.risk)}>{risk(g.risk)}</Badge>
                    </div>
                    <ProgressBar pct={g.progressPct} label={t('hub.goals.progress', { title: g.title, pct: g.progressPct })} />
                    <p className="mt-1 text-xs text-muted">{t('hub.goals.target', { pct: g.progressPct, date: dates.date(g.targetDate) })}{g.nextMilestone ? ` · ${t('hub.goals.next', { title: g.nextMilestone.title })}` : ''}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty text={t('hub.goals.empty')} />}
          </Panel>
        )}
        {e.leave.available && (
          <Panel title={t('hub.leave.title')} actions={<Link className="text-sm text-blue-700 underline" href="/work/leave">{t('hub.leave.open')}</Link>}>
            {e.leave.hasData ? (
              <div className="space-y-3">
                <ul className="grid grid-cols-2 gap-2" aria-label={t('hub.leave.title')}>
                  {e.leave.balances.map((b) => (
                    <li key={b.typeKey} className="rounded-lg border border-line bg-surface p-2.5">
                      <p className="text-xs text-muted">{b.name}</p>
                      <p className="text-lg font-semibold text-ink">{b.remaining}</p>
                      {b.pending > 0 && <p className="text-xs text-gold-700">{t('hub.leave.pending', { n: b.pending })}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            ) : <Empty text={t('hub.leave.empty')} />}
            {e.leave.earnedLeave && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-sm font-medium text-ink">{t('hub.leave.earnedTitle')}</p>
                {e.leave.earnedLeave.started ? (
                  <>
                    <ProgressBar pct={(e.leave.earnedLeave.eligibleDays / e.leave.earnedLeave.required) * 100} label={t('hub.leave.earnedAria')} />
                    <p className="mt-1 text-xs text-muted">{t('hub.leave.earnedBody', { done: e.leave.earnedLeave.eligibleDays, required: e.leave.earnedLeave.required, left: e.leave.earnedLeave.daysToNextCredit })}</p>
                  </>
                ) : <p className="text-xs text-muted">{t('hub.leave.earnedNotStarted')}</p>}
              </div>
            )}
          </Panel>
        )}
        {e.upcomingHolidays.available && (
          <Panel title={t('hub.holidays.title')} actions={<Link className="text-sm text-blue-700 underline" href="/work/holidays">{t('hub.holidays.open')}</Link>}>
            {e.upcomingHolidays.items.length > 0 ? (
              <ul className="space-y-1.5 text-sm" aria-label={t('hub.holidays.title')}>
                {e.upcomingHolidays.items.map((h) => (
                  <li key={`${h.date}-${h.name}`} className="flex justify-between gap-2"><span className="text-ink">{h.name}</span><span className="text-muted">{dates.date(h.date)}</span></li>
                ))}
              </ul>
            ) : <Empty text={t('hub.holidays.empty')} />}
          </Panel>
        )}
        {e.birthdays.available && (
          <Panel title={t('hub.birthdays.title')}>
            {e.birthdays.hasData ? (
              <ul className="space-y-1.5 text-sm" aria-label={t('hub.birthdays.title')}>
                {e.birthdays.items.map((b) => (
                  <li key={b.userId} className="flex justify-between gap-2"><span className="text-ink">{b.name}</span><span className="text-muted">{b.daysAway === 0 ? t('hub.birthdays.today') : t('hub.birthdays.inDays', { n: b.daysAway })}</span></li>
                ))}
              </ul>
            ) : <Empty text={t('hub.birthdays.empty')} />}
          </Panel>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ team */
function TeamBlock({ team }: { team: NonNullable<WorkDashboard['team']> }) {
  const t = useTranslations('workPeople');
  const att = useEnumLabel('attendanceStatus');
  const risk = useEnumLabel('risk');
  const dates = useDates();
  return (
    <section aria-labelledby="hub-team">
      <h2 id="hub-team" className="mb-3 font-display text-xl font-semibold text-ink">{t('hub.team.title', { n: team.members })}</h2>
      <div className="stagger grid gap-4 lg:grid-cols-2">
        {team.attendance.available && (
          <Panel title={t('hub.team.attendance')}>
            {team.attendance.hasData ? (
              <ul className="flex flex-wrap gap-2" aria-label={t('hub.team.attendance')}>
                {Object.entries(team.attendance.counts).map(([s, n]) => <li key={s}><Badge tone={attendanceTone(s)}>{att(s)}: {n}</Badge></li>)}
                {team.attendance.notMarked > 0 && <li><Badge tone="neutral">{t('hub.team.notMarked', { n: team.attendance.notMarked })}</Badge></li>}
              </ul>
            ) : <Empty text={t('hub.team.attendanceEmpty')} />}
          </Panel>
        )}
        {team.tasks.available && (
          <Panel title={t('hub.team.tasks')}>
            {team.tasks.hasData ? (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Row k={t('hub.team.notStarted')} v={team.tasks.notStarted} />
                <Row k={t('hub.team.inProgress')} v={team.tasks.inProgress} />
                <Row k={t('hub.team.inReview')} v={team.tasks.inReview} />
                <Row k={t('hub.team.done30')} v={team.tasks.completedLast30Days} />
                <Row k={t('hub.team.overdue')} v={team.tasks.overdue} danger={team.tasks.overdue > 0} />
              </dl>
            ) : <Empty text={t('hub.team.tasksEmpty')} />}
          </Panel>
        )}
        {team.goals.available && (
          <Panel title={t('hub.team.goals')}>
            {team.goals.hasData ? (
              <>
                <ul className="mb-3 flex flex-wrap gap-2" aria-label={t('hub.team.goals')}>
                  {Object.entries(team.goals.byRisk).map(([r, n]) => <li key={r}><Badge tone={riskTone(r)}>{risk(r)}: {n}</Badge></li>)}
                </ul>
                <ul className="space-y-1 text-sm" aria-label={t('hub.team.lowest')}>
                  {team.goals.byEmployee.slice(0, 5).map((p) => <li key={p.userId} className="flex justify-between gap-2"><Link href={`/work/people/${p.userId}`} className="text-ink hover:underline">{p.name ?? '—'}</Link><span className="text-muted">{p.avgProgressPct}%</span></li>)}
                </ul>
              </>
            ) : <Empty text={t('hub.team.goalsEmpty')} />}
          </Panel>
        )}
        {team.leave.available && (
          <Panel title={t('hub.team.leave')} actions={<Link className="text-sm text-blue-700 underline" href="/work/approvals">{t('hub.team.review')}</Link>}>
            {team.leave.hasData ? (
              <ul className="space-y-1.5 text-sm" aria-label={t('hub.team.leave')}>
                {team.leave.items.map((l) => <li key={l.id} className="flex justify-between gap-2"><span className="text-ink">{l.name ?? '—'}</span><span className="text-muted">{dates.date(l.startDate)} · {l.days}</span></li>)}
              </ul>
            ) : <Empty text={t('hub.team.leaveEmpty')} />}
          </Panel>
        )}
      </div>
      <nav aria-label={t('hub.team.drilldown')} className="mt-3 flex flex-wrap gap-2">
        {team.drilldown.map((x) => <Link key={x.key} href={x.href} className="hover-lift rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-blue-700 hover:bg-champagne-100 focus-visible:outline-2 focus-visible:outline-focus">{t(`hub.team.links.${x.key}` as never)}</Link>)}
      </nav>
    </section>
  );
}

function Row({ k, v, danger }: { k: string; v: number; danger?: boolean }) {
  return (
    <div className="flex justify-between gap-2 rounded-md bg-ivory-100 px-2.5 py-1.5">
      <dt className="text-muted">{k}</dt>
      <dd className={danger ? 'font-semibold text-red-700' : 'font-semibold text-ink'}>{v}</dd>
    </div>
  );
}

/* ------------------------------------------------------------ organisation */
function OrganisationBlock({ org }: { org: NonNullable<WorkDashboard['organisation']> }) {
  const t = useTranslations('workPeople');
  const dates = useDates();
  const att = useEnumLabel('attendanceStatus');
  return (
    <section aria-labelledby="hub-org">
      <SectionTitle><span id="hub-org">{t('hub.org.title')}</span></SectionTitle>
      <div className="stagger mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('hub.org.headcount')} value={org.headcount} accent="gold" />
        <Stat label={t('hub.org.onProbation')} value={org.onProbation} accent="blue" />
        <Stat label={t('hub.org.joiners')} value={org.newJoinersLast30Days} accent="green" />
        {org.pendingLeave.available && <Stat label={t('hub.org.pendingLeave')} value={org.pendingLeave.pending} accent={org.pendingLeave.pending > 0 ? 'red' : 'none'} />}
      </div>
      <div className="stagger grid gap-4 lg:grid-cols-2">
        <Panel title={t('hub.org.departments')}>
          {org.departments.length > 0 ? (
            <ul className="space-y-1.5 text-sm" aria-label={t('hub.org.departments')}>
              {org.departments.map((d) => <li key={d.department} className="flex justify-between gap-2"><Link href={d.href} className="text-blue-700 hover:underline">{d.department}</Link><span className="text-muted">{d.headcount}</span></li>)}
            </ul>
          ) : <Empty text={t('hub.org.departmentsEmpty')} />}
        </Panel>
        <Panel title={t('hub.org.probation', { days: org.probationEndingSoon.windowDays })} actions={<Link className="text-sm text-blue-700 underline" href="/work/hr/probation">{t('hub.org.openProbation')}</Link>}>
          {org.probationEndingSoon.items.length > 0 ? (
            <ul className="space-y-1.5 text-sm" aria-label={t('hub.org.probationList')}>
              {org.probationEndingSoon.items.map((p) => <li key={p.userId} className="flex justify-between gap-2"><Link href={`/work/people/${p.userId}`} className="text-ink hover:underline">{p.name ?? '—'}</Link><span className="text-muted">{dates.date(p.endDate)} · {t('hub.org.daysLeft', { n: p.daysLeft })}</span></li>)}
            </ul>
          ) : <Empty text={t('hub.org.probationEmpty')} />}
        </Panel>
        {org.birthdays.available && (
          <Panel title={t('hub.org.birthdays')} actions={<Link className="text-sm text-blue-700 underline" href="/work/hr/birthdays">{t('hub.org.openBirthdays')}</Link>}>
            {org.birthdays.hasData ? (
              <ul className="space-y-1.5 text-sm" aria-label={t('hub.org.birthdays')}>
                {org.birthdays.items.map((b) => <li key={b.userId} className="flex justify-between gap-2"><span className="text-ink">{b.name}</span><span className="text-muted">{b.daysAway === 0 ? t('hub.birthdays.today') : t('hub.birthdays.inDays', { n: b.daysAway })}</span></li>)}
              </ul>
            ) : <Empty text={t('hub.birthdays.empty')} />}
          </Panel>
        )}
        {org.attendanceExceptions.available && (
          <Panel title={t('hub.org.exceptions')}>
            {org.attendanceExceptions.hasData ? (
              <ul className="flex flex-wrap gap-2" aria-label={t('hub.org.exceptions')}>
                {Object.entries(org.attendanceExceptions.today).map(([s, n]) => <li key={s}><Badge tone={attendanceTone(s)}>{att(s)}: {n}</Badge></li>)}
                {org.attendanceExceptions.missingCheckOutYesterday > 0 && <li><Badge tone="gold">{t('hub.org.missingCheckout', { n: org.attendanceExceptions.missingCheckOutYesterday })}</Badge></li>}
              </ul>
            ) : <Empty text={t('hub.org.exceptionsEmpty')} />}
          </Panel>
        )}
        {org.earnedLeave.available && (
          <Panel title={t('hub.org.earned', { n: org.earnedLeave.creditsLast30Days })}>
            {org.earnedLeave.hasData ? (
              <ul className="space-y-1.5 text-sm" aria-label={t('hub.org.earnedList')}>
                {org.earnedLeave.items.map((x) => <li key={x.id} className="flex justify-between gap-2"><span className="text-ink">{x.name ?? '—'}</span><span className="text-muted">+{x.amount} · {dates.date(x.at)}</span></li>)}
              </ul>
            ) : <Empty text={t('hub.org.earnedEmpty')} />}
          </Panel>
        )}
      </div>
    </section>
  );
}
