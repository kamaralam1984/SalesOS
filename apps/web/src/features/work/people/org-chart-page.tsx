'use client';
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Alert, Avatar, FormField, PageHeader, Select } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState } from '@/features/people/hub/shared';
import { useOrgChart, type OrgNode } from '@/lib/api/hooks/work-people';
import { EmploymentStatus } from '../common';

export function OrgChartPage() {
  return (
    <RequirePermission permission="directory:view">
      <Inner />
    </RequirePermission>
  );
}

type View = 'organisation' | 'department' | 'team';
const isView = (v: string | null): v is View => v === 'organisation' || v === 'department' || v === 'team';

function Inner() {
  const t = useTranslations('workPeople');
  const params = useSearchParams();
  const initialView = params?.get('view') ?? null;
  const [view, setView] = React.useState<View>(isView(initialView) ? initialView : 'organisation');
  const [department, setDepartment] = React.useState(params?.get('department') ?? '');
  const [teamId, setTeamId] = React.useState(params?.get('teamId') ?? '');
  const q = useOrgChart({ view, department: view === 'department' ? department || undefined : undefined, teamId: view === 'team' ? teamId || undefined : undefined });
  const d = q.data;
  return (
    <>
      <PageHeader eyebrow={t('org.eyebrow')} title={t('org.title')} description={t('org.description')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <FormField label={t('org.view')}>
          <Select value={view} onChange={(e) => setView(e.target.value as View)}>
            <option value="organisation">{t('org.views.organisation')}</option>
            <option value="department">{t('org.views.department')}</option>
            <option value="team">{t('org.views.team')}</option>
          </Select>
        </FormField>
        {view === 'department' && (
          <FormField label={t('org.department')}>
            <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">{t('org.chooseDepartment')}</option>
              {(d?.departments ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          </FormField>
        )}
        {view === 'team' && (
          <FormField label={t('org.team')}>
            <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">{t('org.myTeam')}</option>
              {(d?.teams ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </FormField>
        )}
      </div>
      <p className="mb-3 text-sm text-muted">{t('org.initialsNote')}</p>
      <QueryState query={q} isEmpty={!d || d.roots.length === 0} emptyTitle={view === 'department' && !department ? t('org.pickDepartment') : t('org.empty')}>
        {d && (
          <>
            {d.truncated && <Alert tone="warning" className="mb-3">{t('org.truncated', { max: d.limits.maxNodes })}</Alert>}
            <p className="mb-2 text-sm text-muted">{t('org.count', { n: d.total })}</p>
            <ul aria-label={t('org.title')} className="enter-up space-y-2">
              {d.roots.map((r) => <Node key={r.id} node={r} depth={0} />)}
            </ul>
          </>
        )}
      </QueryState>
    </>
  );
}

function Node({ node, depth }: { node: OrgNode; depth: number }) {
  const t = useTranslations('workPeople');
  const [open, setOpen] = React.useState(depth < 2);
  const has = node.children.length > 0;
  return (
    <li>
      <div className="flex items-center gap-2">
        {has ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={t(open ? 'org.collapse' : 'org.expand', { name: node.name })} className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-champagne-100 focus-visible:outline-2 focus-visible:outline-focus">
            {open ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
          </button>
        ) : <span className="size-8 shrink-0" aria-hidden="true" />}
        <Link href={`/work/people/${node.id}`} className="flex min-w-0 flex-1 items-center gap-3 hover-lift rounded-lg border border-line bg-surface p-2.5 hover:border-gold-300 focus-visible:outline-2 focus-visible:outline-focus">
          <Avatar name={node.name} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{node.name}</span>
            <span className="block truncate text-xs text-muted">{[node.designation, node.department].filter(Boolean).join(' · ') || t('directory.noRole')}</span>
          </span>
          {node.directReports > 0 && <span className="hidden text-xs text-muted sm:inline">{t('org.reports', { n: node.directReports })}</span>}
          <EmploymentStatus status={node.status} />
        </Link>
      </div>
      {node.loop && <p className="ml-10 mt-1 text-xs text-red-700">{t('org.loop')}</p>}
      {has && open && (
        <ul className="ml-4 mt-2 space-y-2 border-l border-line pl-3 sm:ml-8">
          {node.children.map((c) => <Node key={c.id} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}
