import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().default('redis://127.0.0.1:6391'),
    BULLMQ_PREFIX: z.string().min(1).default('salesos'),

    /** Comma separated explicit origins. A wildcard is rejected because cookies are credentialed. */
    CORS_ORIGINS: z.string().default('http://localhost:3100'),
    APP_BASE_URL: z.string().url().default('http://localhost:3100'),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_COOKIE_NAME: z.string().default('salesos_session'),
    SESSION_COOKIE_SAMESITE: z.enum(['lax', 'strict']).default('lax'),
    SESSION_COOKIE_DOMAIN: z.string().optional(),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(30),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).default(12),
    SESSION_ROTATE_MINUTES: z.coerce.number().int().min(1).default(15),

    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
    RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).default(60),
    INVITE_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).default(72),

    THROTTLE_STORAGE: z.enum(['redis', 'memory']).default('memory'),
    THROTTLE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
    THROTTLE_LOGIN_LIMIT: z.coerce.number().int().min(1).default(10),

    ENABLE_DOCS: bool.optional(),
    TRUST_PROXY: bool.default('false'),

    /** Bearer token for GET /metrics. Without it /metrics is loopback-only (dev) or 404 (production). */
    METRICS_TOKEN: z.string().min(16, 'METRICS_TOKEN must be at least 16 characters').optional(),
    /** Optional Sentry-compatible error reporting; empty = disabled. Never commit a DSN. */
    SENTRY_DSN: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    SENTRY_ENVIRONMENT: z.string().optional(),
    RELEASE: z.string().optional(),
    /** Optional build metadata shown in the Developer Panel diagnostics (set by CI/deploy; nothing shells out to git). */
    GIT_COMMIT: z.string().max(80).optional(),
    BUILD_TIME: z.string().max(40).optional(),

    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    /** 32 bytes (base64 or 64 hex). Required in production; dev/test derive one from SESSION_SECRET. */
    PLATFORM_ENCRYPTION_KEY: z.string().optional(),
    /** Boot-time DDL (guard triggers, analytics indexes). Default: on in dev/test, OFF in production (migrations own the schema; the app role has no DDL). */
    DB_AUTO_DDL: bool.optional(),
    /** Directory scripts/backup.sh writes to (readable by the API). Unset = backup status reports UNKNOWN. */
    BACKUP_DIR: z.string().optional(),
    /** A backup older than this many hours is reported as STALE (default 26 = daily + slack). */
    BACKUP_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(24 * 60).default(26),
  })
  .superRefine((env, ctx) => {
    const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
    if (origins.length === 0 || origins.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must list explicit origins; "*" is not allowed with credentialed cookies',
      });
    }
    if (env.NODE_ENV === 'production') productionChecks(env, ctx);
  });

const WEAK_SECRET = /change[-_]?me|dev[-_]?only|placeholder|test[-_]session|example|your[-_]?secret|password|default|secret[-_]?key|salesos|coacheasily|openssl/i;
const DEV_DB_PASSWORDS = new Set(['salesos_dev_only', 'postgres', 'password', 'admin', 'root', '123456', 'salesos']);

/** Distinct characters; "aaaa..." or "abababab..." style secrets have very few. */
const distinctChars = (s: string) => new Set(s).size;

function productionChecks(env: Record<string, unknown>, ctx: z.RefinementCtx) {
  const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  const secret = String(env.SESSION_SECRET);
  if (WEAK_SECRET.test(secret) || distinctChars(secret) < 12) bad('SESSION_SECRET', 'Set a real, random SESSION_SECRET in production (openssl rand -base64 48); placeholder/dev/low-entropy values are refused');
  try {
    const u = new URL(String(env.DATABASE_URL));
    const pw = decodeURIComponent(u.password);
    if (!pw || DEV_DB_PASSWORDS.has(pw.toLowerCase()) || /dev[-_]?only|change[-_]?me/i.test(pw)) bad('DATABASE_URL', 'The database password is empty or a known development default; use a strong password for a least-privilege application role (docs/security-review.md section DB roles)');
  } catch { /* url validated by the base schema */ }
  for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) if (!env[k]) bad(k, `${k} is required in production (no fallback to the development object store)`);
  for (const k of ['S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
    const v = env[k];
    if (typeof v === 'string' && /dev[-_]?only|change[-_]?me|^minioadmin$/i.test(v)) bad(k, 'Development object-storage credentials are refused in production');
  }
  if (env.THROTTLE_STORAGE !== 'redis') bad('THROTTLE_STORAGE', 'Rate limits must use the shared Redis store in production (memory counters are per process and reset on restart)');
  const origins = String(env.CORS_ORIGINS).split(',').map((o) => o.trim()).filter(Boolean);
  for (const o of [...origins, String(env.APP_BASE_URL)]) {
    if (!/^https:\/\//i.test(o)) bad(o === String(env.APP_BASE_URL) ? 'APP_BASE_URL' : 'CORS_ORIGINS', `Production origins must be https (got ${o})`);
  }
  if (env.ENABLE_DOCS === true) bad('ENABLE_DOCS', 'Swagger UI relaxes the CSP and must be off in production');
  const key = env.PLATFORM_ENCRYPTION_KEY;
  if (typeof key !== 'string' || !key) bad('PLATFORM_ENCRYPTION_KEY', 'PLATFORM_ENCRYPTION_KEY is required in production (32 bytes, base64 or 64 hex chars)');
  else {
    const buf = /^[0-9a-fA-F]{64}$/.test(key) ? Buffer.from(key, 'hex') : Buffer.from(key, 'base64');
    if (buf.length !== 32) bad('PLATFORM_ENCRYPTION_KEY', 'PLATFORM_ENCRYPTION_KEY must decode to exactly 32 bytes');
    else if (new Set(buf).size < 16) bad('PLATFORM_ENCRYPTION_KEY', 'PLATFORM_ENCRYPTION_KEY has too little entropy (generate with openssl rand -base64 32)');
  }
}

export type Env = z.infer<typeof envSchema> & { corsOrigins: string[]; isProd: boolean; docsEnabled: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    ...e,
    corsOrigins: e.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    isProd: e.NODE_ENV === 'production',
    docsEnabled: e.ENABLE_DOCS ?? e.NODE_ENV !== 'production',
  };
}
