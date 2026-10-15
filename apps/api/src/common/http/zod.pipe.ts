import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from './errors';

/**
 * Keys a client must never be able to set through a request body, whatever the schema (mass assignment / privilege
 * escalation / tenant hopping). Most schemas simply strip unknown keys, which is safe but silent; if the client sent one of
 * these and the schema did not consume it, the request is REJECTED so the attempt is visible (and tested) instead of ignored.
 */
export const PRIVILEGED_BODY_KEYS = new Set(
  [
    'organizationId', 'organization_id', 'orgId', 'tenantId',
    'passwordHash', 'password_hash', 'tokenHash', 'token_hash', 'failedLoginCount', 'lockedUntil', 'isSuperuser', 'isAdmin',
    'createdById', 'updatedById', 'deletedById', 'uploaderId', 'actorId', 'approvedById', 'verifiedById', 'recordedById', 'createdAt', 'updatedAt', 'deletedAt',
    'permissions', 'scope', 'sessionFamilyId', 'familyId', 'sha256', 'storageKey', 'bucket',
  ].map((k) => k.toLowerCase()),
);

/** Returns the dotted paths of privileged keys present in `input` but dropped from `output`. */
export function strippedPrivilegedKeys(input: unknown, output: unknown, path = '', depth = 0): string[] {
  if (depth > 6 || !input || typeof input !== 'object') return [];
  if (Array.isArray(input)) {
    const out: string[] = [];
    input.slice(0, 200).forEach((v, i) => out.push(...strippedPrivilegedKeys(v, Array.isArray(output) ? output[i] : undefined, `${path}[${i}]`, depth + 1)));
    return out;
  }
  const o = (output && typeof output === 'object' && !Array.isArray(output) ? output : {}) as Record<string, unknown>;
  const found: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(k in o)) {
      if (PRIVILEGED_BODY_KEYS.has(k.toLowerCase())) found.push(path ? `${path}.${k}` : k);
    } else found.push(...strippedPrivilegedKeys(v, o[k], path ? `${path}.${k}` : k, depth + 1));
  }
  return found;
}

/** Usage: @Body(new ZodPipe(schema)) body: z.infer<typeof schema> */
@Injectable()
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown, meta?: ArgumentMetadata): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Request validation failed',
        400,
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    if (meta?.type === 'body') {
      const bad = strippedPrivilegedKeys(value, result.data);
      if (bad.length) {
        throw new AppError('FORBIDDEN_FIELD', 'Request contains fields that cannot be set by the client', 400, bad.map((path) => ({ path, message: 'not allowed' })));
      }
    }
    return result.data;
  }
}
