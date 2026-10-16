/** Thresholds and limits for the diagnostics panel (milliseconds unless noted). */
export const DB_SLOW_MS = 100;
export const DB_DOWN_MS = 1000;
export const REDIS_SLOW_MS = 50;
export const REDIS_DOWN_MS = 1000;
export const HEALTH_SAMPLES = 5;
export const OUTBOX_SLOW_SECONDS = 60;
export const OUTBOX_DOWN_SECONDS = 300;
export const SLOW_REQUEST_MS = 1000;
export const ERROR_BUFFER_SIZE = 200;
export const RETRY_ALL_MAX = 200;
export const LAST_ERROR_MAX_CHARS = 300;

export const DIAG_AUDIT = {
  JOB_RETRIED: 'devpanel.job_retried',
  JOBS_RETRIED_ALL: 'devpanel.jobs_retried_all',
  JOB_DISCARDED: 'devpanel.job_discarded',
} as const;
