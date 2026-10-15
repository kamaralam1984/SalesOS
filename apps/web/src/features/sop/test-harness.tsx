import { vi } from 'vitest';

/** Shared helpers for the SOP page tests (mock api responses in the API envelope shape). */
export const envelope = (data: unknown, pagination?: object) => ({ data, meta: pagination ? { pagination } : {} });
export const page = { mode: 'page', limit: 12, hasMore: false, page: 1 };

export function mockApi() {
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() };
}
