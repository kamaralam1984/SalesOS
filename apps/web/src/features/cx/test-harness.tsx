import * as React from 'react';
import { vi } from 'vitest';

export const envelope = (data: unknown, pagination?: object) => ({ data, meta: pagination ? { pagination } : {} });
export const page = { mode: 'page', limit: 12, hasMore: false, page: 1 };

/** Route table for the mocked api: first matching prefix wins. */
export function routeApi(table: Record<string, unknown | ((q?: unknown) => unknown)>) {
  return (path: string, q?: unknown) => {
    const key = Object.keys(table).sort((a, b) => b.length - a.length).find((k) => path === k || path.startsWith(k));
    if (!key) return Promise.reject(new Error(`unmocked GET ${path}`));
    const v = table[key];
    return Promise.resolve(typeof v === 'function' ? (v as (q?: unknown) => unknown)(q) : v);
  };
}

export const linkMock = ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>;
export { vi };
