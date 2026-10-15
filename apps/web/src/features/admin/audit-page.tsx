'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { FileJson } from 'lucide-react';
import {
  Button,
  DataTable,
  DatePicker,
  Dialog,
  DialogContent,
  FilterBar,
  FormField,
  Input,
  PageHeader,
  Pagination,
  Badge,
  type Column,
} from '@salesos/ui';
import type { AuditLogEntry } from '@/lib/api/types';
import { useAuditLogs } from '@/lib/api/hooks/admin';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { useDateTimeFormat } from './shared';
import { paginationLabels } from './users-page';

const PAGE_SIZE = 25;

export function AuditPage() {
  return (
    <RequirePermission permission="audit:view" minScope="team">
      <AuditInner />
    </RequirePermission>
  );
}

function AuditInner() {
  const t = useTranslations('admin.audit');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const fmt = useDateTimeFormat();
  const [page, setPage] = React.useState(1);
  const [action, setAction] = React.useState('');
  const [entityType, setEntityType] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [detail, setDetail] = React.useState<AuditLogEntry | null>(null);
  const [applied, setApplied] = React.useState({ action: '', entityType: '', from: '', to: '' });

  const q = useAuditLogs({
    page,
    limit: PAGE_SIZE,
    action: applied.action || undefined,
    entityType: applied.entityType || undefined,
    from: applied.from ? new Date(`${applied.from}T00:00:00`).toISOString() : undefined,
    to: applied.to ? new Date(`${applied.to}T23:59:59`).toISOString() : undefined,
  });

  const activeCount = Object.values(applied).filter(Boolean).length;
  const invalidRange = Boolean(from && to && from > to);

  const columns: Column<AuditLogEntry>[] = [
    {
      id: 'when',
      header: t('colWhen'),
      primary: true,
      cell: (r) => <span className="tabular whitespace-nowrap">{fmt(r.createdAt)}</span>,
    },
    {
      id: 'action',
      header: t('colAction'),
      cell: (r) => (
        <Badge tone={/FAIL|DENIED|DEACTIV/i.test(r.action) ? 'red' : 'blue'}>{r.action}</Badge>
      ),
    },
    {
      id: 'entity',
      header: t('colEntity'),
      cell: (r) => (
        <span>
          {r.entityType}
          {r.entityId ? (
            <span className="ml-1.5 font-mono text-xs text-muted">{r.entityId.slice(0, 8)}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'actor',
      header: t('colActor'),
      cell: (r) => <span>{r.actorName ?? (r.actorId ? r.actorId.slice(0, 8) : t('system'))}</span>,
    },
  ];

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (invalidRange) return;
          setApplied({ action: action.trim(), entityType: entityType.trim(), from, to });
          setPage(1);
        }}
      >
        <FilterBar
          activeCount={activeCount}
          clearLabel={tc('clearFilters')}
          onClear={() => {
            setAction('');
            setEntityType('');
            setFrom('');
            setTo('');
            setApplied({ action: '', entityType: '', from: '', to: '' });
            setPage(1);
          }}
        >
          <FormField label={t('filterAction')} className="w-full sm:w-52">
            <Input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="USER_DEACTIVATED"
            />
          </FormField>
          <FormField label={t('filterEntity')} className="w-full sm:w-44">
            <Input
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="User"
            />
          </FormField>
          <FormField label={t('filterFrom')} className="w-full sm:w-44">
            <DatePicker value={from} onValueChange={setFrom} max={to || undefined} />
          </FormField>
          <FormField
            label={t('filterTo')}
            className="w-full sm:w-44"
            error={invalidRange ? t('rangeInvalid') : undefined}
          >
            <DatePicker value={to} onValueChange={setTo} min={from || undefined} />
          </FormField>
          <Button type="submit" variant="secondary" className="glow-hover" disabled={invalidRange}>
            {t('apply')}
          </Button>
        </FilterBar>
      </form>

      <div className="enter-up min-w-0 max-w-full" style={{ ['--enter-delay' as string]: '80ms' }}>
      <DataTable
        caption={t('title')}
        columns={columns}
        rows={q.data?.items}
        getRowId={(r) => r.id}
        loading={q.isPending}
        loadingLabel={tc('loading')}
        error={
          q.isError ? { message: apiErr(q.error).message, onRetry: () => void q.refetch() } : null
        }
        emptyTitle={t('emptyTitle')}
        emptyDescription={activeCount ? t('emptyFiltered') : t('emptyDescription')}
        actionsHeader={tc('actions')}
        rowActions={(r) => (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<FileJson className="size-4" aria-hidden="true" />}
            onClick={() => setDetail(r)}
          >
            {t('details')}
          </Button>
        )}
      />
      </div>
      {q.data && q.data.items.length > 0 && (
        <Pagination
          className="mt-4 enter-fade"
          page={page}
          hasNext={Boolean(q.data.pagination?.hasMore)}
          total={q.data.pagination?.total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          labels={paginationLabels(tc)}
        />
      )}

      <Dialog open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent
          size="lg"
          title={detail?.action ?? ''}
          description={detail ? fmt(detail.createdAt) : undefined}
          closeLabel={tc('close')}
        >
          {detail && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 break-words text-sm [&>dd]:min-w-0 [&>dd]:break-all enter-fade">
              <dt className="text-muted">{t('colActor')}</dt>
              <dd>{detail.actorName ?? detail.actorId ?? t('system')}</dd>
              <dt className="text-muted">{t('colEntity')}</dt>
              <dd>
                {detail.entityType}{' '}
                <span className="font-mono text-xs text-muted">{detail.entityId}</span>
              </dd>
              {detail.ip && (
                <>
                  <dt className="text-muted">IP</dt>
                  <dd className="font-mono text-xs">{detail.ip}</dd>
                </>
              )}
              <dt className="text-muted">{t('metadata')}</dt>
              <dd>
                <pre className="max-h-72 overflow-auto rounded-md border border-line bg-ivory-100 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(detail.metadata ?? {}, null, 2)}
                </pre>
              </dd>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
