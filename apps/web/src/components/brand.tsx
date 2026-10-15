import * as React from 'react';
import { cn } from '@salesos/ui';

/** Monogram: charcoal rounded square, gold rule, serif "C". Drawn as SVG so it scales crisply and needs no asset. */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('size-9 shrink-0', className)}
    >
      <rect x="0.75" y="0.75" width="46.5" height="46.5" rx="10.5" style={{ fill: 'var(--brand-tile)', stroke: 'var(--brand-ring)' }} strokeWidth="1.5" />
      <path
        d="M31.2 17.6c-1.6-2-4-3.2-6.9-3.2-5 0-8.8 3.8-8.8 9.6s3.8 9.6 8.8 9.6c2.9 0 5.3-1.2 6.9-3.2"
        fill="none"
        style={{ stroke: 'var(--brand-glyph)' }}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id="brand-rule" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#dcbf72" />
          <stop offset="0.55" stopColor="#3b7bd6" />
          <stop offset="1" stopColor="#2d6a4c" />
        </linearGradient>
      </defs>
      <rect x="10" y="38.5" width="28" height="2.4" rx="1.2" fill="url(#brand-rule)" />
    </svg>
  );
}

export function BrandLockup({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('group flex items-center gap-3 transition-[filter] duration-300 hover:drop-shadow-[0_2px_8px_var(--gold-300)]', className)}>
      <BrandMark />
      {!compact && (
        <span className="leading-none">
          <span className="block text-[0.625rem] font-semibold tracking-[0.22em] text-gold-700 uppercase">
            CoachEasily
          </span>
          <span className="text-gold-shine mt-1 block font-display text-[1.375rem] font-semibold tracking-tight text-ink">
            SalesOS
          </span>
        </span>
      )}
    </span>
  );
}
