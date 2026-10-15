'use client';
import * as React from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { cn } from '@salesos/ui';

/**
 * Shared motion pieces for every feature (page polish layer). All of them honour prefers-reduced-motion and none carries information
 * by motion alone. Re-exports the CRM primitives so features need one import path.
 */
export { AccentRule, Reveal, StaggerList } from '@/features/crm/motion';

/** Counts a number up once when it scrolls into view. Pass the final value; `format` renders each frame (default: rounded, en-IN grouping). */
export function CountUp({ value, format, className, duration = 0.9 }: { value: number; format?: (n: number) => string; className?: string; duration?: number }) {
  const reduce = useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (n) => (format ? format(n) : Math.round(n).toLocaleString('en-IN')));
  React.useEffect(() => {
    if (reduce) { mv.set(value); return; }
    if (!inView) return;
    const c = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [inView, value, reduce, duration, mv]);
  return <motion.span ref={ref} className={cn('tabular-nums', className)}>{text}</motion.span>;
}

/** Bar whose fill grows from 0 to `value` % once visible. Decorative: put the number next to it as text. */
export function GrowBar({ value, className, fillClassName }: { value: number; className?: string; fillClassName?: string }) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span aria-hidden="true" className={cn('relative block h-2 w-full overflow-hidden rounded-full bg-champagne-200/70', className)}>
      <motion.span
        className={cn('absolute inset-y-0 left-0 block rounded-full bg-gold-500', fillClassName)}
        initial={reduce ? { width: `${pct}%` } : { width: 0 }}
        whileInView={{ width: `${pct}%` }}
        viewport={{ once: true }}
        transition={{ duration: reduce ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
    </span>
  );
}
