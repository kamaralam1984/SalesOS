import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@salesos/shared-types';

export const uuidSchema = z.string().uuid();

/** Cursor OR page based list query; limit is bounded by MAX_PAGE_SIZE. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).max(512).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** http(s) URL only: z.string().url() also accepts javascript:, data:, file: and vbscript: which become stored XSS when rendered as a link. */
export const httpUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .url()
  // scheme must be http(s); the authority (before the first / ? #) may not contain credentials (user:pass@host)
  .refine((v) => /^https?:\/\/[^\s@/?#\\]+(?:[/?#]\S*)?$/i.test(v), { message: 'Only http(s) links without embedded credentials are allowed' });
