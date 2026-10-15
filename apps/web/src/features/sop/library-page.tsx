'use client';
import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BadgeCheck, BookOpenCheck, CircleAlert, Plus, Search } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, FormField, Input, PageHeader, Pagination, Select, Skeleton, StatusBadge } from '@salesos/ui';
import { StaggerList } from '@/components/motion';
import { RequirePermission } from '@/features/auth/require-permission';
import { Can } from '@/features/auth/auth-provider';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useSopList, type SopListItem } from './api';
import { SOP_CATEGORIES } from './categories';
import { useDebounced, useFmt, usePaginationLabels, VersionStatusBadge } from './shared';

export function LibraryPage() {
  return (
    <RequirePermission permission="sop:view">
      <LibraryInner />
    </RequirePermission>
  );
}

function LibraryInner() {
  const t = useTranslations('sop');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const labels = usePaginationLabels();
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [mandatory, setMandatory] = React.useState('');
  const [page, setPage] = React.useState(1);
  const q = useDebounced(search.trim());
  const query = useSopList({
    page,
    limit: 12,
    q: q.length >= 2 ? q : undefined,
    category: category || undefined,
    mandatory: mandatory || undefined,
  });
  const filtered = Boolean(q || category || mandatory);

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('library.title')}
        description={t('library.description')}
        actions={
          <>
            <Can permission="sop:adoption:view">
              <Button asChild variant="secondary"><Link href="/sop/adoption">{t('nav.adoption')}</Link></Button>
            </Can>
            <Can permission="sop:gaps:view">
              <Button asChild variant="secondary"><Link href="/sop/gaps">{t('nav.gaps')}</Link></Button>
            </Can>
            <Can permission="sop:approve">
              <Button asChild variant="secondary"><Link href="/sop/approvals">{t('nav.approvals')}</Link></Button>
            </Can>
            <Can permission="sop:create">
              <Button asChild><Link href="/sop/new"><Plus className="size-4" aria-hidden="true" />{t('library.new')}</Link></Button>
            </Can>
          </>
        }
      />
      <form role="search" aria-label={t('library.searchLabel')} className="mb-5 grid gap-3 sm:grid-cols-[1fr_13rem_14rem]" onSubmit={(e) => e.preventDefault()}>
        <FormField label={t('library.search')} hideLabel>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-500" aria-hidden="true" />
            <Input className="pl-9" type="search" placeholder={t('library.searchPlaceholder')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </FormField>
        <FormField label={t('library.category')} hideLabel>
          <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
            <option value="">{t('library.allCategories')}</option>
            {SOP_CATEGORIES.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
          </Select>
        </FormField>
        <FormField label={t('library.requirement')} hideLabel>
          <Select value={mandatory} onChange={(e) => { setMandatory(e.target.value); setPage(1); }}>
            <option value="">{t('library.allRequirements')}</option>
            <option value="true">{t('library.mandatoryOnly')}</option>
            <option value="false">{t('library.optionalOnly')}</option>
          </Select>
        </FormField>
      </form>

      {query.isPending ? (
        <div className="grid gap-3 md:grid-cols-2" role="status" aria-busy="true" aria-label={tc('loading')}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}
        </div>
      ) : query.isError ? (
        <ErrorState description={apiErr(query.error).message} requestId={apiErr(query.error).requestId} onRetry={() => query.refetch()} retryLabel={tc('retry')} />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          icon={<BookOpenCheck className="size-6" aria-hidden="true" />}
          title={filtered ? t('library.noMatches') : t('library.empty')}
          description={filtered ? t('library.noMatchesHint') : t('library.emptyHint')}
          action={filtered ? <Button variant="secondary" onClick={() => { setSearch(''); setCategory(''); setMandatory(''); setPage(1); }}>{tc('clearFilters')}</Button> : undefined}
        />
      ) : (
        <>
          <section aria-label={t('library.listLabel')}><StaggerList className="grid gap-3 md:grid-cols-2">
            {query.data.items.map((d) => <SopCard key={d.id} doc={d} />)}
          </StaggerList></section>
          <Pagination className="mt-5" page={page} hasNext={Boolean(query.data.pagination?.hasMore)} onPageChange={setPage} labels={labels} />
        </>
      )}
    </>
  );
}

function SopCard({ doc }: { doc: SopListItem }) {
  const t = useTranslations('sop');
  const fmt = useFmt();
  const eff = doc.effectiveVersion;
  return (
    <Link
      href={`/sop/${doc.id}`}
      className="group accent-top hover-lift glow-hover block min-w-0 rounded-lg border border-line bg-surface p-4 shadow-xs transition-[box-shadow,transform,border-color] hover:border-gold-400/60 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone="blue">{t(`categories.${doc.category}`)}</Badge>
        {doc.isMandatory ? <Badge tone="gold">{t('mandatory')}</Badge> : <Badge>{t('optional')}</Badge>}
        {doc.status === 'RETIRED' && <Badge tone="red">{t('retired')}</Badge>}
      </div>
      <h2 className="font-display text-lg font-semibold text-ink group-hover:underline">{doc.title}</h2>
      {doc.summary && <p className="mt-1 line-clamp-2 text-sm text-muted">{doc.summary}</p>}
      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-ink-600">
        <div className="flex gap-1"><dt className="sr-only">{t('owner')}</dt><dd>{t('ownedBy', { name: doc.ownerName ?? '—' })}</dd></div>
        {eff ? (
          <div className="flex gap-1"><dt className="sr-only">{t('effective')}</dt><dd>{t('effectiveLine', { version: eff.versionNumber, date: fmt.date(eff.effectiveDate) })}</dd></div>
        ) : (
          <div><span>{t('noEffective')}</span></div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {eff && doc.isMandatory && (eff.acknowledgedByMe ? (
          <StatusBadge status="success">{t('acknowledged')}</StatusBadge>
        ) : (
          <StatusBadge status="warning">{t('needsAck')}</StatusBadge>
        ))}
        {doc.openVersion && (
          <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-600">
            {doc.openVersion.status === 'PENDING_APPROVAL' ? <CircleAlert className="size-4" aria-hidden="true" /> : <BadgeCheck className="size-4" aria-hidden="true" />}
            {t('openVersion', { version: doc.openVersion.versionNumber })} <VersionStatusBadge status={doc.openVersion.status} />
          </span>
        )}
      </div>
    </Link>
  );
}
