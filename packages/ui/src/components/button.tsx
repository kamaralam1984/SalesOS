'use client';
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../lib/cn';
import { Spinner } from './spinner';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'gold'
  | 'blue'
  | 'green'
  | 'charcoal';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

/* Primary = gold gradient with a sheen sweep. Blue = info / workflow actions, green = confirm / money-in. */
const variants: Record<ButtonVariant, string> = {
  primary:
    'sheen glow-gold bg-(image:--gold-gradient) text-on-gold border border-gold-600 shadow-gold hover:brightness-105 hover:shadow-md active:brightness-95',
  gold: 'sheen glow-gold bg-(image:--gold-gradient) text-on-gold border border-gold-600 shadow-gold hover:brightness-105 hover:shadow-md active:brightness-95',
  blue: 'sheen glow-blue bg-(image:--blue-gradient) text-white border border-blue-700 shadow-blue hover:brightness-110 active:brightness-95',
  green:
    'sheen glow-green bg-(image:--green-gradient) text-white border border-green-700 shadow-green hover:brightness-110 active:brightness-95',
  charcoal:
    'sheen bg-inverse text-on-inverse shadow-sm hover:brightness-125 active:brightness-90 border border-inverse-line',
  secondary:
    'bg-surface text-ink border border-control shadow-xs hover:bg-champagne-100 hover:border-gold-500 hover:shadow-sm active:bg-champagne-200',
  ghost:
    'bg-transparent text-ink border border-transparent hover:bg-champagne-100 active:bg-champagne-200',
  danger:
    'sheen bg-red-600 text-white border border-red-600 shadow-sm hover:brightness-90 active:brightness-85',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-[0.8125rem] gap-1.5',
  md: 'min-h-11 px-4 text-sm gap-2 md:min-h-10',
  lg: 'min-h-12 px-6 text-base gap-2.5',
  icon: 'size-11 p-0 md:size-10',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks activation. Label stays in the DOM. */
  loading?: boolean;
  /** Screen-reader text announced while loading. */
  loadingLabel?: string;
  asChild?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel = 'Loading',
    disabled,
    asChild,
    leadingIcon,
    trailingIcon,
    children,
    type,
    onClick,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const classes = cn(
    'relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-md font-medium',
    'transition-[background-color,border-color,box-shadow,transform,filter] duration-200 ease-out',
    'hover:-translate-y-px active:translate-y-0 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-55 aria-disabled:shadow-none! aria-disabled:animate-none! aria-disabled:hover:translate-y-0 aria-disabled:active:scale-100 aria-disabled:after:hidden',
    'aria-busy:cursor-progress disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none! disabled:animate-none! disabled:hover:translate-y-0 disabled:after:hidden',
    variants[variant],
    sizes[size],
    className,
  );
  if (asChild) {
    return (
      <Slot ref={ref as React.Ref<HTMLElement>} className={classes} {...(rest as object)}>
        {children as React.ReactElement}
      </Slot>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      aria-busy={loading || undefined}
      aria-disabled={isDisabled || undefined}
      disabled={disabled}
      onClick={(e) => {
        if (isDisabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {loading ? <Spinner className="enter-fade size-4" /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
      {loading && (
        <span className="sr-only" role="status">
          {loadingLabel}
        </span>
      )}
    </button>
  );
});
