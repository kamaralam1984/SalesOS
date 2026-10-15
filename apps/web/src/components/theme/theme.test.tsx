import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { NextIntlClientProvider } from 'next-intl';
import { TooltipProvider } from '@salesos/ui';
import en from '../../../messages/en.json';
import hi from '../../../messages/hi.json';
import mr from '../../../messages/mr.json';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { ThemeProvider, resetThemeMemoryForTests, useTheme } from './theme-provider';
import { ThemeMenu, ThemeSegmented } from './theme-switcher';

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <TooltipProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </TooltipProvider>
    </NextIntlClientProvider>
  );
}

function mockMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  window.matchMedia = (() => mq) as unknown as typeof window.matchMedia;
  return {
    flip(next: boolean) {
      mq.matches = next;
      listeners.forEach((l) => l());
    },
  };
}

const root = () => document.documentElement;

describe('ThemeProvider + switcher', () => {
  const original = window.matchMedia;
  beforeEach(() => {
    resetThemeMemoryForTests();
    window.localStorage.clear();
    root().removeAttribute('data-theme');
    root().removeAttribute('data-theme-pref');
    document.head.innerHTML = '<meta name="theme-color" content="#fbf8f2">';
  });
  afterEach(() => {
    window.matchMedia = original;
    vi.restoreAllMocks();
  });

  it('defaults to System and follows the OS (dark)', () => {
    mockMatchMedia(true);
    render(<ThemeSegmented />, { wrapper: Wrap });
    expect(screen.getByRole('radio', { name: /system/i })).toHaveAttribute('aria-checked', 'true');
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(root().getAttribute('data-theme-pref')).toBe('system');
    expect(root().style.colorScheme).toBe('dark');
  });

  it('reacts live when the OS preference changes while on System', () => {
    const mm = mockMatchMedia(false);
    render(<ThemeSegmented />, { wrapper: Wrap });
    expect(root().getAttribute('data-theme')).toBe('light');
    act(() => mm.flip(true));
    expect(root().getAttribute('data-theme')).toBe('dark');
  });

  it('persists an explicit choice, updates meta theme-color and restores it on next mount', () => {
    mockMatchMedia(false);
    const first = render(<ThemeSegmented />, { wrapper: Wrap });
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#14110d');
    first.unmount();
    render(<ThemeSegmented />, { wrapper: Wrap });
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  });

  it('an explicit Light choice wins over a dark OS', () => {
    mockMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<ThemeSegmented />, { wrapper: Wrap });
    expect(root().getAttribute('data-theme')).toBe('light');
  });

  it('still switches for the session when storage is blocked', () => {
    mockMatchMedia(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<ThemeSegmented />, { wrapper: Wrap });
    expect(screen.getByRole('radio', { name: /system/i })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(root().getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  });

  it('segmented control supports arrow keys (roving tabindex)', () => {
    mockMatchMedia(false);
    render(<ThemeSegmented />, { wrapper: Wrap });
    const system = screen.getByRole('radio', { name: /system/i });
    expect(system).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(system, { key: 'ArrowRight' }); // wraps to Light
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
  });

  it('top-bar menu button is labelled with the current theme', () => {
    mockMatchMedia(false);
    render(<ThemeMenu />, { wrapper: Wrap });
    expect(screen.getByRole('button', { name: /theme: system/i })).toBeInTheDocument();
  });

  it('useTheme outside the provider throws a clear error', () => {
    const Bad = () => {
      useTheme();
      return null;
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow(/ThemeProvider/);
  });

  it('segmented control has no axe violations', async () => {
    mockMatchMedia(false);
    const { container } = render(<ThemeSegmented />, { wrapper: Wrap });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('theme messages', () => {
  it.each([
    ['en', en],
    ['hi', hi],
    ['mr', mr],
  ] as const)('%s has all labels', (_l, m) => {
    const t = (m as unknown as { theme: Record<string, string> }).theme;
    for (const k of ['label', 'light', 'dark', 'system']) expect(t[k]).toBeTruthy();
  });
  it('hi and mr are translated (not English copies)', () => {
    expect((hi as unknown as { theme: { dark: string } }).theme.dark).not.toBe('Dark');
    expect((mr as unknown as { theme: { label: string } }).theme.label).not.toBe('Theme');
  });
});
