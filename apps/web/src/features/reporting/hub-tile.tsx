'use client';
import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@salesos/ui';

export type TileAccent = 'gold' | 'blue' | 'green';

const ACCENTS: TileAccent[] = ['gold', 'blue', 'green'];
/** Rotates gold / blue / green so a grid of tiles reads as one premium set. */
export const accentAt = (i: number): TileAccent => ACCENTS[i % ACCENTS.length]!;

const rule: Record<TileAccent, string> = {
  gold: 'from-gold-500 via-gold-300 to-gold-500/20',
  blue: 'from-blue-600 via-blue-500 to-blue-600/20',
  green: 'from-green-600 via-green-600/70 to-green-600/20',
};
const chip: Record<TileAccent, string> = {
  gold: 'bg-gold-50 text-gold-700 ring-gold-300/70',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  green: 'bg-green-50 text-green-700 ring-green-600/25',
};

/** Premium link tile: animated accent rule that draws across on hover, lift, arrow nudge. */
export function HubTile({
  href,
  icon,
  title,
  body,
  extra,
  accent = 'gold',
  className,
}: {
  href: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  extra?: React.ReactNode;
  accent?: TileAccent;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'ui-anim-rise-in group relative flex h-full gap-3 overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-xs sm:p-5',
        'transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-x-0 top-0 h-[2px] origin-left scale-x-[0.35] bg-gradient-to-r transition-transform duration-500 ease-out group-hover:scale-x-100 motion-reduce:scale-x-100 motion-reduce:transition-none',
          rule[accent],
        )}
      />
      <span aria-hidden="true" className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 [&>svg]:size-5', chip[accent])}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
        {body && <span className="mt-0.5 block text-sm text-muted">{body}</span>}
        {extra}
      </span>
      <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-ink-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink motion-reduce:transition-none" />
    </Link>
  );
}
