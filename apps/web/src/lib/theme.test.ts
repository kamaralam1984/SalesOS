import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  THEME_COLORS,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
} from './theme';

describe('theme helpers', () => {
  it('defaults to system and rejects garbage', () => {
    expect(readStoredPreference({ getItem: () => null })).toBe('system');
    expect(readStoredPreference({ getItem: () => 'purple' })).toBe('system');
    expect(readStoredPreference({ getItem: () => 'dark' })).toBe('dark');
    expect(readStoredPreference(null)).toBe('system');
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference(undefined)).toBe(false);
  });

  it('survives storage that throws', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readStoredPreference(boom)).toBe('system');
    expect(writeStoredPreference(boom, 'dark')).toBe(false);
    expect(writeStoredPreference(null, 'dark')).toBe(false);
  });

  it('persists a valid choice under the versioned key', () => {
    const setItem = vi.fn();
    expect(writeStoredPreference({ setItem }, 'light')).toBe(true);
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'light');
  });

  it('resolves system from the OS preference and keeps explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('applyTheme sets data-theme, color-scheme and theme-color meta', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#fbf8f2">';
    applyTheme('system', 'dark');
    const root = document.documentElement;
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-theme-pref')).toBe('system');
    expect(root.style.colorScheme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(THEME_COLORS.dark);
    applyTheme('light', 'light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(THEME_COLORS.light);
  });
});

describe('pre-paint init script', () => {
  const run = (stored: string | null | 'throw', osDark: boolean) => {
    document.head.innerHTML = '<meta name="theme-color" content="#fbf8f2">';
    document.documentElement.removeAttribute('data-theme');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        if (stored === 'throw') throw new Error('blocked');
        return stored;
      },
    });
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: osDark && q.includes('dark') })) as unknown as typeof window.matchMedia;
    try {
      new Function(THEME_INIT_SCRIPT)();
    } finally {
      window.matchMedia = mm;
      vi.unstubAllGlobals();
    }
    return document.documentElement.getAttribute('data-theme');
  };

  it('is valid JS with no template placeholders', () => {
    expect(() => new Function(THEME_INIT_SCRIPT)).not.toThrow();
    expect(THEME_INIT_SCRIPT.length).toBeLessThan(900);
  });
  it('follows the OS when nothing is stored (default System)', () => {
    expect(run(null, true)).toBe('dark');
    expect(run(null, false)).toBe('light');
  });
  it('honours a stored explicit choice over the OS', () => {
    expect(run('light', true)).toBe('light');
    expect(run('dark', false)).toBe('dark');
  });
  it('falls back to System when storage throws', () => {
    expect(run('throw', true)).toBe('dark');
    expect(run('throw', false)).toBe('light');
  });
  it('updates the theme-color meta before paint', () => {
    run('dark', false);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(THEME_COLORS.dark);
  });
});

describe('dark tokens', () => {
  const css = readFileSync(path.resolve(__dirname, '../../../../packages/ui/src/styles/tokens.css'), 'utf8');
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

  it('has the explicit and the media-query dark blocks, kept identical', () => {
    const explicit = css.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/);
    const media = css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\) \{([\s\S]*?)\n  \}\n\}/);
    expect(explicit).not.toBeNull();
    expect(media).not.toBeNull();
    expect(norm(explicit![1]!)).toBe(norm(media![1]!));
    expect(explicit![1]).toContain('color-scheme: dark');
  });

  it('remaps every raw ramp the components use', () => {
    const dark = css.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)![1]!;
    for (const v of ['--ivory-50', '--ivory-100', '--ivory-200', '--ink-900', '--ink-500', '--gold-50', '--gold-500', '--gold-700', '--red-50', '--red-700', '--blue-50', '--blue-700', '--green-50', '--green-700', '--line', '--control-border', '--scrim', '--on-gold', '--elev-3', '--chart-blue']) {
      expect(dark, v).toContain(`${v}:`);
    }
  });

  it('keeps the browser-chrome colours in step with --canvas', () => {
    expect(css).toContain(`--ivory-100: ${THEME_COLORS.dark};`);
    expect(css).toContain(`--canvas: var(--ivory-100)`);
    expect(THEME_COLORS.light).toBe('#fbf8f2');
  });
});
