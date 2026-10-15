'use client';
import * as React from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './button';

/* ---------- Pagination (page-based and cursor-based) ---------- */
export interface PaginationProps {
  page?: number;
  pageCount?: number;
  total?: number;
  pageSize?: number;
  onPageChange?: (p: number) => void;
  /** Cursor mode */
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  labels?: {
    nav: string;
    previous: string;
    next: string;
    summary: (from: number, to: number, total: number) => string;
    page: (p: number, count: number) => string;
    pageOnly?: (p: number) => string;
  };
  className?: string;
}

const defaultLabels: NonNullable<PaginationProps['labels']> = {
  nav: 'Pagination',
  previous: 'Previous',
  next: 'Next',
  summary: (f, t, total) => `Showing ${f}–${t} of ${total}`,
  page: (p, c) => `Page ${p} of ${c}`,
};

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  labels = defaultLabels,
  className,
}: PaginationProps) {
  const pageMode = typeof page === 'number';
  const prevDisabled = pageMode ? page <= 1 : !hasPrev;
  const nextDisabled = typeof pageCount === 'number' && pageMode ? page >= pageCount : !hasNext;
  const from = pageMode && total && pageSize ? (page - 1) * pageSize + 1 : undefined;
  const to = pageMode && total && pageSize ? Math.min(page * pageSize, total) : undefined;
  return (
    <nav
      aria-label={labels.nav}
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
    >
      <p className="text-sm text-muted" aria-live="polite">
        {!pageMode
          ? ''
          : from && to && total
            ? labels.summary(from, to, total)
            : typeof pageCount === 'number'
              ? labels.page(page, pageCount)
              : (labels.pageOnly ?? ((p: number) => `Page ${p}`))(page)}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={prevDisabled}
          leadingIcon={<ChevronLeft className="size-4" aria-hidden="true" />}
          onClick={() => (pageMode ? onPageChange?.(page - 1) : onPrev?.())}
        >
          {labels.previous}
        </Button>
        {pageMode && (
          <span className="tabular px-1 text-sm text-ink-700" aria-hidden="true">
            {typeof pageCount === 'number' ? `${page} / ${pageCount}` : page}
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={nextDisabled}
          trailingIcon={<ChevronRight className="size-4" aria-hidden="true" />}
          onClick={() => (pageMode ? onPageChange?.(page + 1) : onNext?.())}
        >
          {labels.next}
        </Button>
      </div>
    </nav>
  );
}

/* ---------- FilterBar ---------- */
export function FilterBar({
  children,
  search,
  onSearchChange,
  searchLabel = 'Search',
  searchPlaceholder = 'Search…',
  onClear,
  clearLabel = 'Clear filters',
  activeCount = 0,
  className,
}: {
  children?: React.ReactNode;
  search?: string;
  onSearchChange?: (v: string) => void;
  searchLabel?: string;
  searchPlaceholder?: string;
  onClear?: () => void;
  clearLabel?: string;
  activeCount?: number;
  className?: string;
}) {
  return (
    <div
      role="search"
      className={cn(
        'mb-4 flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 shadow-xs sm:flex-row sm:flex-wrap sm:items-end',
        className,
      )}
    >
      {onSearchChange && (
        <div className="relative min-w-0 flex-1 sm:min-w-56">
          <label htmlFor="filterbar-search" className="sr-only">
            {searchLabel}
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-500"
          />
          <input
            id="filterbar-search"
            type="search"
            value={search ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-11 w-full rounded-md border border-control bg-surface pr-3 pl-9 text-[0.9375rem] placeholder:text-ink-500 hover:border-ink-400 focus-visible:border-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600/30 focus-visible:outline-offset-0 md:h-10"
          />
        </div>
      )}
      {children}
      {onClear && activeCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          leadingIcon={<X className="size-4" aria-hidden="true" />}
        >
          {clearLabel} ({activeCount})
        </Button>
      )}
    </div>
  );
}
