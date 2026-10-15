import type { PaginationMeta } from './pagination';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiMeta {
  requestId?: string;
  /** Non-blocking advisory messages (e.g. team size above soft limit). */
  warnings?: string[];
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

/** Every /api/v1 JSON response uses this shape. */
export interface ApiEnvelope<T> {
  data: T | null;
  meta: ApiMeta;
  error: ApiErrorBody | null;
}
