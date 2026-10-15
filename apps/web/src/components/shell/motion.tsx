'use client';
import * as React from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@salesos/ui';

const TONES = {
  gold: 'var(--accent-gold)',
  blue: 'var(--accent-blue)',
  green: 'var(--accent-green)',
  tri: 'var(--accent-tricolor)',
} as const;
// Faint coloured glow in dark (tokens resolve to `none` in light).
const GLOW = {
  gold: 'var(--tone-glow-gold)',
  blue: 'var(--tone-glow-blue)',
  green: 'var(--tone-glow-green)',
  tri: 'var(--tone-glow-gold)',
} as const;

/** Animated accent rule: draws in from the left, optional slow sheen. gold = premium, blue = info/active, green = success/growth. */
export function AccentRail({
  tone = 'gold',
  className,
  delay = 0,
  sheen = false,
}: {
  tone?: keyof typeof TONES;
  className?: string;
  delay?: number;
  sheen?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <span aria-hidden="true" className={cn('relative block h-[2px] w-full overflow-hidden rounded-full', className)}>
      <motion.span
        className="absolute inset-0 origin-left"
        style={{ background: TONES[tone], boxShadow: GLOW[tone] }}
        initial={reduce ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.9, delay, ease: [0.2, 0.7, 0.2, 1] }}
      />
      {sheen && !reduce && (
        <motion.span
          className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-(--travel-color) to-transparent"
          initial={{ left: '-30%' }}
          animate={{ left: '130%' }}
          transition={{ duration: 2.4, delay: delay + 1, repeat: Infinity, repeatDelay: 4, ease: 'easeInOut' }}
        />
      )}
    </span>
  );
}

/** Staggered entrance. Renders statically under reduced motion. */
export function Reveal({
  children,
  delay = 0,
  className,
  y = 14,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Count-up for an already-formatted value string (keeps the caller's currency/locale formatting). The first numeric run is
 * animated; the final render is always the exact original string. Non-numeric text (dash, "n/a") is shown untouched.
 */
export function CountUp({ text, locale, className, ...rest }: { text: string; locale?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  const reduce = useReducedMotion();
  const [anim, setAnim] = React.useState<{ for: string; text: string } | null>(null);
  const shown = anim && anim.for === text ? anim.text : text;
  React.useEffect(() => {
    if (reduce) return;
    const m = /\d[\d,]*(?:\.(\d+))?/.exec(text);
    if (!m) return;
    const target = Number(m[0].replace(/,/g, ''));
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = m[1]?.length ?? 0;
    const nf = new Intl.NumberFormat(locale ?? 'en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const pre = text.slice(0, m.index);
    const post = text.slice(m.index + m[0].length);
    const controls = animate(0, target, {
      duration: 0.9,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (v) => setAnim({ for: text, text: `${pre}${nf.format(v)}${post}` }),
      onComplete: () => setAnim(null),
    });
    return () => controls.stop();
  }, [text, locale, reduce]);
  return (
    <span className={className} {...rest}>
      {shown}
    </span>
  );
}
