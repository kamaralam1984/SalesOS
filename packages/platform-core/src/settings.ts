import type { Prisma } from '@prisma/client';

export type Db = Prisma.TransactionClient;

export interface FilesSettings {
  maxBytesByCategory: { image: number; document: number; csv: number };
  userQuotaBytes: number;
  orgQuotaBytes: number;
  maxImagePixels: number;
  maxCsvRows: number;
  /** retention days by category; null = keep until deleted */
  retentionDays: { image: number | null; document: number | null; csv: number | null; payment_proof: number | null; temp: number };
  signedUrlTtlSeconds: number;
  /** how long soft-deleted files are kept before the object is purged */
  purgeAfterDays: number;
}

export const DEFAULT_FILES_SETTINGS: FilesSettings = {
  maxBytesByCategory: { image: 10 * 1024 * 1024, document: 10 * 1024 * 1024, csv: 10 * 1024 * 1024 },
  userQuotaBytes: 100 * 1024 * 1024,
  orgQuotaBytes: 5 * 1024 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  maxCsvRows: 50_000,
  retentionDays: { image: null, document: null, csv: 30, payment_proof: 365 * 7, temp: 7 },
  signedUrlTtlSeconds: 300,
  purgeAfterDays: 30,
};

export interface AiSettings {
  enabled: boolean;
  provider: 'fake' | 'openai' | 'gemini' | 'anthropic';
  model: string;
  /** requests per user per minute */
  rateLimitPerMinute: number;
  redactPii: boolean;
}
export const DEFAULT_AI_SETTINGS: AiSettings = { enabled: false, provider: 'fake', model: 'local-deterministic-1', rateLimitPerMinute: 10, redactPii: true };

export interface FeatureFlags {
  /** Companion devices (POST /devices/register). Android go/no-go = NO-GO for v1 (DEC-036). */
  'devices.enabled': boolean;
  /** Recording assets. BLOCKED pending legal review (DEC-014): no API path sets this to true. */
  'recordings.enabled': boolean;
}

export async function getSetting<T extends object>(db: Db, organizationId: string, key: string, defaults: T): Promise<T> {
  const row = await db.platformSetting.findUnique({ where: { organizationId_key: { organizationId, key } } });
  const value = row?.value;
  return { ...defaults, ...(value && typeof value === 'object' && !Array.isArray(value) ? (value as object) : {}) } as T;
}

export async function putSetting(db: Db, organizationId: string, key: string, value: object, updatedById?: string): Promise<void> {
  await db.platformSetting.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, value: value as Prisma.InputJsonValue, updatedById: updatedById ?? null },
    update: { value: value as Prisma.InputJsonValue, updatedById: updatedById ?? null },
  });
}

export async function getFlag(db: Db, organizationId: string, flag: keyof FeatureFlags): Promise<boolean> {
  const s = await getSetting<Partial<FeatureFlags>>(db, organizationId, 'flags', {});
  return s[flag] === true;
}
