import * as React from 'react';
import { cn } from '@salesos/ui';

const LOGO = '/brand/coacheasily-logo.png';
const MARK = '/brand/coacheasily-mark.png';

/** Twinkling stars: [left %, top %, delay s]. Purely decorative. */
const STARS: ReadonlyArray<readonly [number, number, number]> = [[8, 6, 0], [47, 2, 1.1], [71, 12, 2.2], [93, 4, 0.6]];

/**
 * The CoachEasily gold flame mark (transparent PNG) with a flicker and a light sweep.
 * Sized by the parent class (default size-9). Decorative unless `title` is given.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('logo-anim size-9 shrink-0', className)}
      style={{ '--logo-url': `url(${MARK})` } as React.CSSProperties}
    >
      <span className="logo-anim__flame block size-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARK} alt="" draggable={false} className="logo-anim__base size-full object-contain" />
      </span>
      <span className="logo-anim__shine" />
    </span>
  );
}

/**
 * The full CoachEasily logo, always alive: a light sweep across the letters, a gold line that draws
 * itself with a spark running along it, and twinkling stars. `compact` shows the flame only.
 */
export function BrandLockup({ className, compact }: { className?: string; compact?: boolean }) {
  if (compact) return <BrandMark className={className} />;
  return (
    <span className={cn('inline-flex w-full max-w-[17rem] flex-col items-stretch', className)}>
      <span role="img" aria-label="CoachEasily" className="logo-anim" style={{ '--logo-url': `url(${LOGO})` } as React.CSSProperties}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO} alt="" draggable={false} className="logo-anim__base" />
        <span className="logo-anim__shine" />
        {STARS.map(([left, top, delay]) => (
          <span key={left} aria-hidden="true" className="logo-anim__star" style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${delay}s` }} />
        ))}
      </span>
      <span aria-hidden="true" className="logo-anim__line" />
      <span className="text-gold-shine mt-1.5 block text-center font-display text-sm font-semibold tracking-[0.3em] text-ink uppercase">SalesOS</span>
    </span>
  );
}
