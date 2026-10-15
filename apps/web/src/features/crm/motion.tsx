'use client';
import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PageHeader as UiPageHeader, cn } from '@salesos/ui';

/**
 * Premium motion + accent primitives shared by the CRM and Revenue features.
 * All motion respects prefers-reduced-motion. Accent colours follow the design rules:
 * gold = premium emphasis, blue = info / active workflow, green = success / money-in, red = errors only.
 */
export type AccentTone = 'gold' | 'blue' | 'green' | 'tri';

const toneBg: Record<AccentTone, string> = {
  gold: 'bg-gold-500',
  blue: 'bg-blue-600',
  green: 'bg-green-600',
  tri: 'bg-gradient-to-r from-gold-500 via-blue-600 to-green-600',
};

/** Thin animated accent line: draws in once, then a slow sheen passes over it. */
export function AccentRule({ tone = 'tri', className }: { tone?: AccentTone; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('relative block h-[2px] w-full overflow-hidden rounded-full', className)}>
      <span className={cn('ui-accent-draw absolute inset-0 block', toneBg[tone])} />
      <span className="ui-accent-sheen absolute inset-y-0 left-0 block w-1/4 bg-gradient-to-r from-transparent via-(--travel-color) to-transparent" />
    </span>
  );
}

/** Shared PageHeader (already carries the animated tricolour rule from @salesos/ui). */
export const PageHeader = UiPageHeader;

/** Fade + rise on mount. */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** List with staggered item entrance. Children must be keyed elements; each is wrapped in an li (or div). */
export function StaggerList({
  children,
  as = 'ul',
  className,
  step = 0.04,
  itemClassName,
}: {
  children: React.ReactNode;
  as?: 'ul' | 'ol' | 'div';
  className?: string;
  step?: number;
  itemClassName?: string;
}) {
  const reduce = useReducedMotion();
  const Wrapper = as;
  const Item = as === 'div' ? motion.div : motion.li;
  return (
    <Wrapper className={className}>
      {React.Children.toArray(children).map((child, i) => (
        <Item
          key={React.isValidElement(child) && child.key != null ? child.key : i}
          className={itemClassName}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: Math.min(i, 12) * step, ease: [0.22, 1, 0.36, 1] }}
          layout={reduce ? false : 'position'}
        >
          {child}
        </Item>
      ))}
    </Wrapper>
  );
}
