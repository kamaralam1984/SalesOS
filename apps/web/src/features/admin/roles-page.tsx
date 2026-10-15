'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  ErrorState,
  LoadingRegion,
  PageHeader,
  Panel,
  Skeleton,
  EmptyState,
} from '@salesos/ui';
import { usePermissionCatalogue } from '@/lib/api/hooks/admin';
import { RequirePermission } from '@/features/auth/require-permission';
import { useApiErrorMessage } from '@/hooks/use-api-error';
import { ROLE_KEYS } from '@/lib/api/types';

export function RolesPage() {
  return (
    <RequirePermission permission="users:role:assign">
      <RolesInner />
    </RequirePermission>
  );
}

function RolesInner() {
  const t = useTranslations('admin.roles');
  const tr = useTranslations('roles');
  const tc = useTranslations('common');
  const apiErr = useApiErrorMessage();
  const q = usePermissionCatalogue();

  const catalogue = q.data;
  const grouped = React.useMemo(() => {
    const m = new Map<string, NonNullable<typeof catalogue>>();
    for (const e of catalogue ?? []) {
      const list = m.get(e.domain) ?? [];
      list.push(e);
      m.set(e.domain, list);
    }
    return [...m.entries()];
  }, [catalogue]);

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {q.isPending && (
        <LoadingRegion label={tc('loading')} className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </LoadingRegion>
      )}
      {q.isError && (
        <ErrorState
          description={apiErr(q.error).message}
          onRetry={() => void q.refetch()}
          retryLabel={tc('retry')}
        />
      )}
      {q.data && q.data.length === 0 && <EmptyState title={t('empty')} />}
      <div className="stagger space-y-6">
        {grouped.map(([domain, entries]) => (
          <Panel accent="gold" key={domain} title={domain} headingLevel={2}>
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">{domain}</caption>
                <thead>
                  <tr className="border-b border-line text-xs tracking-wide text-muted uppercase">
                    <th scope="col" className="px-4 py-2 font-semibold sm:px-5">
                      {t('permission')}
                    </th>
                    {ROLE_KEYS.map((r) => (
                      <th
                        key={r}
                        scope="col"
                        className="px-2 py-2 text-center font-semibold"
                        title={tr(r)}
                      >
                        <abbr title={tr(r)} className="no-underline">
                          {r
                            .split('_')
                            .map((w) => w[0])
                            .join('')}
                        </abbr>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {entries.map((e) => (
                    <tr key={e.key} className="transition-colors hover:bg-gold-50/50">
                      <th scope="row" className="px-4 py-2.5 font-normal sm:px-5">
                        <code className="font-mono text-[0.8125rem] text-ink">{e.key}</code>
                        {e.sensitive && (
                          <Badge tone="red" className="ml-2">
                            {t('sensitive')}
                          </Badge>
                        )}
                        <span className="block text-[0.8125rem] text-muted">{e.description}</span>
                      </th>
                      {ROLE_KEYS.map((r) => (
                        <td key={r} className="px-2 py-2.5 text-center">
                          {e.grants[r] ? (
                            <span className="tabular text-xs font-semibold text-ink">
                              {e.grants[r]}
                            </span>
                          ) : (
                            <span aria-label={t('none')} className="text-ink-500">
                              –
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
