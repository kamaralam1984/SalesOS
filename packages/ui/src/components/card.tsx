import * as React from 'react';
import { cn } from '../lib/cn';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export interface CardProps extends DivProps {
  /** Thin accent rule across the top edge. */
  accent?: 'gold' | 'red' | 'blue' | 'green' | 'none';
  /** Animated travelling light along the accent rule (not for red). Default true. */
  animated?: boolean;
  /** Premium surface: larger radius, layered shadow. */
  premium?: boolean;
  /** Lift on hover (use for clickable cards). */
  interactive?: boolean;
  padded?: boolean;
  as?: 'div' | 'section' | 'article';
}

const accentColors = {
  gold: 'accent-line-gold',
  red: 'bg-red-600',
  blue: 'accent-line-blue',
  green: 'accent-line-green',
} as const;

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    className,
    accent = 'none',
    animated = true,
    premium = false,
    interactive = false,
    padded = true,
    as: As = 'div',
    children,
    ...rest
  },
  ref,
) {
  return (
    <As
      ref={ref as React.Ref<HTMLDivElement>}
      className={cn(
        premium ? 'panel-premium' : 'panel',
        'enter-up',
        accent === 'gold' && 'glow-gold',
        accent === 'blue' && 'glow-blue',
        accent === 'green' && 'glow-green',
        interactive && 'hover-lift glow-hover',
        padded && 'p-4 sm:p-5',
        className,
      )}
      {...rest}
    >
      {accent !== 'none' && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-x-0 top-0 z-[1] h-[2px]',
            accentColors[accent],
            (!animated || accent === 'red') && 'after:hidden',
          )}
        />
      )}
      {children}
    </As>
  );
});

export interface PanelProps extends Omit<CardProps, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  headingLevel?: 2 | 3 | 4;
  footer?: React.ReactNode;
}

/** Card with a consistent header (title, description, actions) and optional footer. */
export function Panel({
  title,
  description,
  actions,
  headingLevel = 2,
  footer,
  children,
  className,
  ...rest
}: PanelProps) {
  const H = `h${headingLevel}` as 'h2';
  const hasHeader = title || description || actions;
  return (
    <Card padded={false} className={className} as="section" {...rest}>
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-gradient-to-b from-transparent to-champagne-100/40 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {title && (
              <H className="font-display text-lg leading-snug font-semibold text-ink">{title}</H>
            )}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
      {footer && (
        <footer className="border-t border-line bg-ivory-100 px-4 py-3 sm:px-5">{footer}</footer>
      )}
    </Card>
  );
}
