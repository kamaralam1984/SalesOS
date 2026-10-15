'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Avatar, FormField, Input, PageHeader, Pagination, Select } from '@salesos/ui';
import { RequirePermission } from '@/features/auth/require-permission';
import { QueryState } from '@/features/people/hub/shared';
import { useDirectory, useDirectoryDepartments, type DirectoryRow } from '@/lib/api/hooks/work-people';
import { EmploymentStatus } from '../common';


function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

export function DirectoryPage() {
  return (
    <RequirePermission permission="directory:view">
      <Inner />
    </RequirePermission>
  );
}

const PAGE_SIZE = 20;

function Inner() {
  const t = useTranslations('workPeople');
  const tc = useTranslations('common');
  const [search, setSearch] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const debounced = useDebounced(search);
  const q = useDirectory({ page, limit: PAGE_SIZE, search: debounced || undefined, department: department || undefined, status: status || undefined });
  const deps = useDirectoryDepartments();
  const filtered = Boolean(debounced || department || status);
  return (
    <>
      <PageHeader eyebrow={t('directory.eyebrow')} title={t('directory.title')} description={t('directory.description')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label={t('directory.filters')}>
        <FormField label={t('directory.search')} className="lg:col-span-2">
          <Input type="search" value={search} maxLength={100} placeholder={t('directory.searchPlaceholder')} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </FormField>
        <FormField label={t('directory.department')}>
          <Select value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }}>
            <option value="">{t('directory.anyDepartment')}</option>
            {(deps.data ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </FormField>
        <FormField label={t('directory.status')}>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('directory.currentStaff')}</option>
            <option value="ACTIVE">{t('status.ACTIVE')}</option>
            <option value="PROBATION">{t('status.PROBATION')}</option>
            <option value="EXITED">{t('status.EXITED')}</option>
          </Select>
        </FormField>
      </div>
      <QueryState query={q} isEmpty={(q.data?.items.length ?? 0) === 0} emptyTitle={filtered ? t('directory.noMatches') : t('directory.empty')} emptyDescription={filtered ? t('directory.noMatchesBody') : undefined}>
        <ul className="stagger-fast grid gap-2 md:grid-cols-2" aria-label={t('directory.title')}>
          {(q.data?.items ?? []).map((p: DirectoryRow) => (
            <li key={p.id}>
              <Link href={`/work/people/${p.id}`} className="hover-lift flex items-center gap-3 rounded-lg border border-line bg-surface p-3.5 hover:border-gold-300 focus-visible:outline-2 focus-visible:outline-focus">
                <Avatar name={p.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{p.name}</span>
                  <span className="block truncate text-sm text-muted">{[p.designation, p.department].filter(Boolean).join(' · ') || t('directory.noRole')}</span>
                  <span className="block truncate text-xs text-muted">{[p.employeeCode, p.manager ? t('directory.reportsTo', { name: p.manager.name }) : null].filter(Boolean).join(' · ')}</span>
                </span>
                <EmploymentStatus status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
        {(q.data?.pagination?.hasMore || page > 1) && (
          <Pagination
            className="mt-4"
            page={page}
            hasPrev={page > 1}
            hasNext={Boolean(q.data?.pagination?.hasMore)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            labels={{ nav: tc('pagination'), previous: tc('previous'), next: tc('next'), summary: () => '', page: () => '', pageOnly: (p) => tc('paginationPageOnly', { page: p }) }}
          />
        )}
      </QueryState>
    </>
  );
}
