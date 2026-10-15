'use client';
import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Check, Minus } from 'lucide-react';
import { cn } from '../lib/cn';

/* ---------- FormField: label + control + hint + error wiring ---------- */

interface FieldContext {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}
const FieldCtx = React.createContext<FieldContext | null>(null);
export const useFieldContext = () => React.useContext(FieldCtx);

export interface FormFieldProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  /** Visually hide the label but keep it for assistive tech. */
  hideLabel?: boolean;
  /** Optional HintTip shown beside the label (outside the <label>, so it does not change the field's name). */
  info?: React.ReactNode;
  className?: string;
  /** Optional explicit id; generated otherwise. */
  id?: string;
  children: React.ReactNode;
  /** Text shown for required marker for screen readers. */
  requiredLabel?: string;
}

export function FormField({
  label,
  hint,
  error,
  required = false,
  hideLabel,
  info,
  className,
  id,
  children,
  requiredLabel = 'required',
}: FormFieldProps) {
  const gen = React.useId();
  const fid = id ?? gen;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errorId = error ? `${fid}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldCtx.Provider value={{ id: fid, describedBy, invalid: Boolean(error), required }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        {info ? (
          <div className="flex items-center gap-1">
            <label
              htmlFor={fid}
              className={cn('text-sm font-medium text-ink transition-colors', hideLabel && 'sr-only', error && 'text-red-700')}
            >
              {label}
              {required && (
                <>
                  <span aria-hidden="true" className="ml-0.5 text-red-700">
                    *
                  </span>
                  <span className="sr-only"> ({requiredLabel})</span>
                </>
              )}
            </label>
            {info}
          </div>
        ) : (
          <label
            htmlFor={fid}
            className={cn('text-sm font-medium text-ink', hideLabel && 'sr-only')}
          >
            {label}
            {required && (
              <>
                <span aria-hidden="true" className="ml-0.5 text-red-700">
                  *
                </span>
                <span className="sr-only"> ({requiredLabel})</span>
              </>
            )}
          </label>
        )}
        {children}
        {hint && (
          <p id={hintId} className="text-[0.8125rem] text-muted transition-opacity">
            {hint}
          </p>
        )}
        {error && (
          <p
            id={errorId}
            role="alert"
            className="enter-up flex items-start gap-1.5 text-[0.8125rem] font-medium text-red-700"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="mt-0.5 size-3.5 shrink-0"
              fill="currentColor"
            >
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-.75 3.25h1.5v4h-1.5v-4Zm0 5.25h1.5v1.5h-1.5V10Z" />
            </svg>
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldCtx.Provider>
  );
}

const controlBase =
  'w-full rounded-md border bg-surface px-3 text-[0.9375rem] text-ink shadow-xs placeholder:text-ink-500 ' +
  'transition-[border-color,box-shadow,background-color] duration-200 ease-out ' +
  'hover:border-ink-600 focus-visible:border-blue-600 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-blue-600/30 focus-visible:shadow-[0_0_0_4px_rgb(37_99_235/0.12),0_2px_10px_rgb(37_99_235/0.10)] ' +
  'disabled:cursor-not-allowed disabled:bg-ivory-200 disabled:text-ink-500 read-only:bg-ivory-100';

function useFieldProps(props: {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
  required?: boolean;
}) {
  const ctx = useFieldContext();
  return {
    id: props.id ?? ctx?.id,
    'aria-describedby':
      [props['aria-describedby'], ctx?.describedBy].filter(Boolean).join(' ') || undefined,
    'aria-invalid': props['aria-invalid'] ?? (ctx?.invalid ? true : undefined),
    required: props.required ?? ctx?.required,
    invalid:
      Boolean(ctx?.invalid) || props['aria-invalid'] === true || props['aria-invalid'] === 'true',
  };
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  const f = useFieldProps(props as never);
  const { invalid, ...ariaProps } = f;
  return (
    <input
      ref={ref}
      {...props}
      {...ariaProps}
      className={cn(
        controlBase,
        'h-11 md:h-10',
        invalid ? 'border-red-600' : 'border-control',
        className,
      )}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...props }, ref) {
  const f = useFieldProps(props as never);
  const { invalid, ...ariaProps } = f;
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...props}
      {...ariaProps}
      className={cn(
        controlBase,
        'min-h-24 py-2.5 leading-relaxed',
        invalid ? 'border-red-600' : 'border-control',
        className,
      )}
    />
  );
});

/** Native select, styled. Native keeps mobile pickers and screen-reader behaviour intact. */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  const f = useFieldProps(props as never);
  const { invalid, ...ariaProps } = f;
  return (
    <div className="relative">
      <select
        ref={ref}
        {...props}
        {...ariaProps}
        className={cn(
          controlBase,
          'h-11 appearance-none pr-9 md:h-10',
          invalid ? 'border-red-600' : 'border-control',
          className,
        )}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 8 5 5 5-5" />
      </svg>
    </div>
  );
});

/* ---------- Checkbox ---------- */

export interface CheckboxProps extends Omit<
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  'children'
> {
  label?: React.ReactNode;
  description?: React.ReactNode;
}

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(function Checkbox({ className, label, description, id, ...props }, ref) {
  const gen = React.useId();
  const cid = id ?? gen;
  const box = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={cid}
      aria-describedby={description ? `${cid}-desc` : undefined}
      className={cn(
        'mt-0.5 flex size-[1.15rem] shrink-0 items-center justify-center rounded-[5px] border border-control bg-surface shadow-xs',
        'transition-colors hover:border-ink-500 data-[state=checked]:border-inverse-line data-[state=checked]:bg-inverse data-[state=indeterminate]:border-inverse-line data-[state=indeterminate]:bg-inverse',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-on-inverse">
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3.5" strokeWidth={3} />
        ) : (
          <Check className="size-3.5" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <div className="flex items-start gap-2.5 py-1">
      {box}
      <div className="min-w-0">
        <label htmlFor={cid} className="cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        {description && (
          <p id={`${cid}-desc`} className="text-[0.8125rem] text-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
});

/* ---------- Switch ---------- */

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  label?: React.ReactNode;
  description?: React.ReactNode;
}

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  function Switch({ className, label, description, id, ...props }, ref) {
    const gen = React.useId();
    const sid = id ?? gen;
    const control = (
      <SwitchPrimitive.Root
        ref={ref}
        id={sid}
        aria-describedby={description ? `${sid}-desc` : undefined}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-control bg-ivory-300 p-0.5 transition-colors',
          'data-[state=checked]:border-inverse-line data-[state=checked]:bg-inverse disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb className="block size-[1.15rem] translate-x-0 rounded-full bg-(--thumb) shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-5 data-[state=checked]:bg-(--thumb-on)" />
      </SwitchPrimitive.Root>
    );
    if (!label) return control;
    return (
      <div className="flex items-start justify-between gap-4 py-1">
        <div className="min-w-0">
          <label htmlFor={sid} className="cursor-pointer text-sm font-medium text-ink">
            {label}
          </label>
          {description && (
            <p id={`${sid}-desc`} className="text-[0.8125rem] text-muted">
              {description}
            </p>
          )}
        </div>
        {control}
      </div>
    );
  },
);

/* ---------- DatePicker (native date input, styled; value is YYYY-MM-DD) ---------- */

export interface DatePickerProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'defaultValue'
> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** 'datetime-local' for date + time. */
  mode?: 'date' | 'datetime-local';
}

export const DatePicker = React.forwardRef<HTMLInputElement, DatePickerProps>(function DatePicker(
  { className, onValueChange, mode = 'date', ...props },
  ref,
) {
  const f = useFieldProps(props as never);
  const { invalid, ...ariaProps } = f;
  return (
    <input
      ref={ref}
      type={mode}
      {...props}
      {...ariaProps}
      onChange={(e) => onValueChange?.(e.target.value)}
      className={cn(
        controlBase,
        'h-11 md:h-10',
        invalid ? 'border-red-600' : 'border-control',
        className,
      )}
    />
  );
});
