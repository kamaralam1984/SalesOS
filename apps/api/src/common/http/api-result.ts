import type { PaginationMeta } from '@salesos/shared-types';

export interface ResultMeta {
  warnings?: string[];
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

/** Return from a controller to attach meta (pagination, warnings) to the envelope. */
export class ApiResult<T = unknown> {
  constructor(
    public readonly data: T,
    public readonly meta: ResultMeta = {},
  ) {}
}
export const ok = <T>(data: T, meta: ResultMeta = {}) => new ApiResult(data, meta);
