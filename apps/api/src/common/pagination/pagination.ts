import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type PaginationMeta } from '@salesos/shared-types';
import { ApiResult } from '../http/api-result';
import { AppError } from '../http/errors';

export interface PageQuery {
  limit?: number;
  cursor?: string;
  page?: number;
}

export function clampLimit(limit?: number): number {
  const n = Number.isFinite(limit) ? Math.floor(limit as number) : DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(n, 1), MAX_PAGE_SIZE);
}

export const encodeCursor = (id: string): string => Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
export function decodeCursor(cursor: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id?: unknown };
    if (typeof parsed.id === 'string' && parsed.id.length > 0 && parsed.id.length <= 128) return parsed.id;
  } catch {
    /* fallthrough */
  }
  throw new AppError('INVALID_CURSOR', 'Invalid pagination cursor', 400);
}

/**
 * Prisma args for keyset-ish pagination. Your orderBy MUST end with a unique tiebreaker (`{ id: 'desc' }`).
 * Fetches limit+1 rows so we know whether another page exists.
 *   const args = pageArgs(q); const rows = await prisma.x.findMany({ where, orderBy:[{createdAt:'desc'},{id:'desc'}], ...args });
 *   return pageResult(rows, q);
 */
export function pageArgs(q: PageQuery): { take: number; skip?: number; cursor?: { id: string } } {
  const limit = clampLimit(q.limit);
  if (q.cursor) return { take: limit + 1, skip: 1, cursor: { id: decodeCursor(q.cursor) } };
  if (q.page && q.page > 1) return { take: limit + 1, skip: (q.page - 1) * limit };
  return { take: limit + 1 };
}

/** Builds the envelope result (items in data, pagination in meta) from rows fetched with pageArgs(). */
export function pageResult<T extends { id: string }>(rows: T[], q: PageQuery, total?: number): ApiResult<T[]> {
  const limit = clampLimit(q.limit);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const pagination: PaginationMeta = q.cursor || !q.page
    ? { mode: 'cursor', limit, hasMore, nextCursor: hasMore ? encodeCursor(items[items.length - 1]!.id) : null }
    : {
        mode: 'page',
        limit,
        hasMore,
        page: q.page,
        ...(total !== undefined ? { total, totalPages: Math.max(1, Math.ceil(total / limit)) } : {}),
      };
  return new ApiResult(items, { pagination });
}
