import { LoggerModule } from 'nestjs-pino';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.link',
  '*.variables',
  '*.secret',
  'password',
  'token',
  'authorization',
  'cookie',
  // deeper nesting and other credential-bearing field names (pino wildcards match exactly one level each)
  '*.*.password', '*.*.passwordHash', '*.*.token', '*.*.tokenHash', '*.*.secret', '*.*.link', '*.*.variables',
  '*.newPassword', '*.currentPassword', '*.oldPassword', '*.apiKey', '*.api_key', '*.accessKey', '*.secretKey', '*.privateKey',
  '*.csrfToken', '*.sessionToken', '*.refreshToken', '*.accessToken', '*.webhookSecret', '*.signature', '*.cipher', '*.webhookSecretCipher', '*.secretCipher',
  'newPassword', 'apiKey', 'csrfToken', 'secret', 'webhookSecret',
  'req.headers["x-api-key"]', 'req.headers["x-signature"]', 'req.headers["x-webhook-signature"]', 'req.headers["proxy-authorization"]',
  'req.headers.cookie', 'res.headers["set-cookie"]',
];

export const AppLoggerModule = LoggerModule.forRootAsync({
  inject: [APP_ENV],
  useFactory: (env: Env) => ({
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      genReqId: (req: unknown) => (req as { id?: string }).id ?? 'unknown',
      customProps: () => ({ service: 'salesos-api' }),
      serializers: {
        req: (req: { id: string; method: string; url: string; headers: Record<string, unknown> }) => ({
          id: req.id,
          method: req.method,
          url: String(req.url).split('?')[0], // never log query strings (may carry tokens/PII)
          headers: req.headers,
        }),
      },
      autoLogging: env.NODE_ENV !== 'test',
    },
  }),
});
