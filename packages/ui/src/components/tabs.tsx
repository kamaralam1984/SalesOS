'use client';
import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../lib/cn';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...p }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'flex w-full gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]',
        className,
      )}
      {...p}
    />
  );
});

export const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...p }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'relative -mb-px inline-flex min-h-11 shrink-0 items-center gap-2 px-3.5 text-sm font-medium whitespace-nowrap text-muted transition-colors',
        'hover:text-ink data-[state=active]:text-ink',
        'after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:origin-left after:scale-x-0 after:rounded-full after:bg-(image:--accent-gold) after:transition-transform after:duration-300 after:ease-out',
        'hover:after:scale-x-50 data-[state=active]:after:scale-x-100',
        'data-[state=active]:font-semibold data-[state=active]:after:shadow-[0_0_8px_rgb(201_160_58/0.55)]',
        'hover:bg-ivory-100/60 rounded-t-md',
        className,
      )}
      {...p}
    />
  );
});

export const TabsContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...p }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('pt-4 focus-visible:outline-offset-4', className)}
      {...p}
    />
  );
});
