'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

/* ---------- Dialog ---------- */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps extends Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  'title'
> {
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  closeLabel?: string;
  size?: 'sm' | 'md' | 'lg';
}


/**
 * Radix only restores focus on close when a <DialogTrigger> exists. Most dialogs here are opened from controlled state,
 * so remember the element that had focus when the dialog opened and put focus back on it when it closes (WCAG 2.4.3).
 */
function useRestoreFocus(props: {
  onOpenAutoFocus?: (e: Event) => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const opener = React.useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (e: Event) => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      props.onOpenAutoFocus?.(e);
    },
    onCloseAutoFocus: (e: Event) => {
      props.onCloseAutoFocus?.(e);
      if (e.defaultPrevented) return;
      const el = opener.current;
      if (el && el.isConnected && el !== document.body) {
        e.preventDefault();
        el.focus();
      }
    },
  };
}

const dialogSizes = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent(
  { title, description, footer, closeLabel = 'Close', size = 'md', className, children, ...props },
  ref,
) {
  const restoreFocus = useRestoreFocus(props);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-overlay fixed inset-0 z-50 bg-scrim" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'ui-dialog fixed z-50 flex max-h-[92dvh] flex-col border border-line bg-(image:--raised-gradient) shadow-[var(--shadow-xl,0_20px_50px_rgb(0_0_0/0.18)),0_0_28px_rgb(201_160_58/0.14)]',
          // mobile: bottom sheet-like, desktop: centred
          'inset-x-0 bottom-0 rounded-t-xl sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
          dialogSizes[size],
          className,
        )}
        {...props}
        {...restoreFocus}
      >
        <span aria-hidden="true" className="accent-line accent-line-gold absolute inset-x-0 top-0 rounded-none" />
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="font-display text-xl font-semibold text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="-mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ivory-200 hover:text-ink"
          >
            <X className="size-5" aria-hidden="true" />
          </DialogPrimitive.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-col-reverse gap-2 border-t border-line bg-ivory-100 px-5 py-3.5 pb-safe sm:flex-row sm:justify-end sm:rounded-b-xl">
            {footer}
          </footer>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

/* ---------- Sheet / Drawer (side or bottom) ---------- */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps extends Omit<DialogContentProps, 'size'> {
  side?: 'right' | 'left' | 'bottom';
}

const sheetSide = {
  right: 'ui-sheet-right inset-y-0 right-0 w-full max-w-md border-l',
  left: 'ui-sheet-left inset-y-0 left-0 w-full max-w-xs border-r',
  bottom: 'ui-sheet-bottom inset-x-0 bottom-0 max-h-[88dvh] rounded-t-xl border-t',
};

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  {
    title,
    description,
    footer,
    closeLabel = 'Close',
    side = 'right',
    className,
    children,
    ...props
  },
  ref,
) {
  const restoreFocus = useRestoreFocus(props);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-overlay fixed inset-0 z-50 bg-scrim" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col border-line bg-(image:--raised-gradient) shadow-xl shadow-gold-500/10',
          sheetSide[side],
          className,
        )}
        {...props}
        {...restoreFocus}
      >
        <span aria-hidden="true" className="accent-line accent-line-gold absolute inset-x-0 top-0 rounded-none" />
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="font-display text-xl font-semibold text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="-mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ivory-200 hover:text-ink"
          >
            <X className="size-5" aria-hidden="true" />
          </DialogPrimitive.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-col-reverse gap-2 border-t border-line bg-ivory-100 px-5 py-3.5 pb-safe sm:flex-row sm:justify-end">
            {footer}
          </footer>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

/* ---------- Dropdown menu ---------- */
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Label>
>(function DropdownMenuLabel({ className, ...p }, ref) {
  return (
    <DropdownPrimitive.Label
      ref={ref}
      className={cn(
        'px-3 py-1.5 text-xs font-semibold tracking-wide text-muted uppercase',
        className,
      )}
      {...p}
    />
  );
});
export const DropdownMenuSeparator = () => (
  <DropdownPrimitive.Separator className="my-1 h-px bg-line" />
);

export const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 8, align = 'end', ...p }, ref) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'ui-pop z-50 min-w-56 rounded-lg border border-line bg-raised p-1.5 shadow-md',
          className,
        )}
        {...p}
      />
    </DropdownPrimitive.Portal>
  );
});

export const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & { danger?: boolean }
>(function DropdownMenuItem({ className, danger, ...p }, ref) {
  return (
    <DropdownPrimitive.Item
      ref={ref}
      className={cn(
        'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-3 text-sm outline-none select-none',
        'data-[highlighted]:bg-ivory-200 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        danger ? 'text-red-700' : 'text-ink',
        className,
      )}
      {...p}
    />
  );
});

export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup;
export const DropdownMenuRadioItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DropdownPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...p }, ref) {
  return (
    <DropdownPrimitive.RadioItem
      ref={ref}
      className={cn(
        'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-3 text-sm text-ink outline-none select-none',
        'data-[highlighted]:bg-ivory-200 data-[state=checked]:font-semibold',
        className,
      )}
      {...p}
    >
      <span className="inline-flex size-4 items-center justify-center" aria-hidden="true">
        <DropdownPrimitive.ItemIndicator>
          <span className="block size-2 rounded-full bg-gold-500" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.RadioItem>
  );
});

/* ---------- Popover ---------- */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, sideOffset = 8, align = 'start', ...p }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'ui-pop z-50 rounded-lg border border-line bg-raised p-3 shadow-md shadow-gold-500/10',
          className,
        )}
        {...p}
      />
    </PopoverPrimitive.Portal>
  );
});

/* ---------- Tooltip ---------- */
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({
  label,
  children,
  side = 'top',
}: {
  label: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="ui-pop z-50 max-w-xs rounded-md bg-inverse px-2.5 py-1.5 text-xs font-medium text-on-inverse shadow-md"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
