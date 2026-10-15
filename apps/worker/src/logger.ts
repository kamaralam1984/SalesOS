import pino from 'pino';

export type Logger = pino.Logger;
export const createLogger = (level = 'info'): Logger =>
  pino({
    level,
    base: { service: 'salesos-worker' },
    redact: { paths: ['*.password', '*.token', '*.link', '*.variables', 'payload.variables'], censor: '[REDACTED]' },
  });
