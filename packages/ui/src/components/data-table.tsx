'use client';
import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../lib/cn';
import { EmptyState, ErrorState, Skeleton } from './feedback';

export interface Column<T> {
  id: string;
  header: string;
  /** Cell renderer. */
  cell: (row: T) => React.ReactNode;
  /** Shown as the card title on mobile (first primary column used as card heading). */
  primary?: boolean;
  /** Hide this column in the mobile card view. */
  hideOnMobile?: boolean;
  align?: 'left' | 'right';
  className?: string;
  sortable?: boolean;
}

export interface SortState {
  columnId: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  getRowId: (row: T) => string;
  caption: string;
  loading?: boolean;
  error?: { message?: string; onRetry?: () => void } | null;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  /** Row-level actions rendered in the last column (desktop) / card footer (mobile). */
  rowActions?: (row: T) => React.ReactNode;
  actionsHeader?: string;
  sort?: SortState | null;
  onSortChange?: (s: SortState | null) => void;
  skeletonRows?: number;
  className?: string;
  loadingLabel?: string;
}

/** Desktop: semantic table. Mobile (<md): stacked cards. Same data, one source of truth. */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  loading,
  error,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  emptyAction,
  onRowClick,
  rowActions,
  actionsHeader = 'Actions',
  sort,
  onSortChange,
  skeletonRows = 5,
  className,
  loadingLabel = 'Loading',
}: DataTableProps<T>) {
  if (error) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <ErrorState description={error.message} onRetry={error.onRetry} compact />
      </div>
    );
  }
  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)}
      >
        <span className="sr-only">{loadingLabel}</span>
        <div className="divide-y divide-line">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong bg-surface/60">
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
          compact
        />
      </div>
    );
  }

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const secondary = columns.filter((c) => c !== primary && !c.hideOnMobile);

  return (
    <div className={className}>
      {/* Desktop table */}
      <div role="region" aria-label={caption} tabIndex={0} className="hidden overflow-x-auto rounded-lg border border-line bg-surface shadow-md focus-visible:outline-2 focus-visible:outline-focus md:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-gold-300/60 bg-gradient-to-b from-ivory-100 to-champagne-100/60">
              {columns.map((c) => {
                const sorted = sort?.columnId === c.id ? sort.direction : null;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={
                      sorted
                        ? sorted === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : c.sortable
                          ? 'none'
                          : undefined
                    }
                    className={cn(
                      'px-4 py-3 text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase',
                      c.align === 'right' && 'text-right',
                    )}
                  >
                    {c.sortable && onSortChange ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 uppercase hover:text-ink"
                        onClick={() =>
                          onSortChange(
                            !sorted
                              ? { columnId: c.id, direction: 'asc' }
                              : sorted === 'asc'
                                ? { columnId: c.id, direction: 'desc' }
                                : null,
                          )
                        }
                      >
                        {c.header}
                        {sorted === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {rowActions && (
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">{actionsHeader}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, i) => (
              <tr
                key={getRowId(row)}
                style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
                className={cn(
                  'data-row enter-fade transition-[background-color,box-shadow] duration-200 hover:bg-champagne-100/60 hover:shadow-[inset_3px_0_0_var(--color-gold-500,#c9a03a)]',
                  onRowClick && 'cursor-pointer',
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn(
                      'px-4 py-3.5 align-middle text-ink',
                      c.align === 'right' && 'text-right tabular',
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
                {rowActions && (
                  <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1">{rowActions(row)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul aria-label={caption} className="space-y-3 md:hidden">
        {rows.map((row, i) => (
          <li
            key={getRowId(row)}
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            className={cn(
              'panel enter-up p-4',
              onRowClick && 'active:bg-ivory-100',
            )}
          >
            <div
              className={cn(onRowClick && 'cursor-pointer')}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {primary && <div className="font-medium text-ink">{primary.cell(row)}</div>}
              {secondary.length > 0 && (
                <dl className="mt-2.5 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                  {secondary.map((c) => (
                    <React.Fragment key={c.id}>
                      <dt className="text-muted">{c.header}</dt>
                      <dd className="min-w-0 text-right text-ink">{c.cell(row)}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
            </div>
            {rowActions && (
              <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                {rowActions(row)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
