import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { APP_ENV } from './config/config.module';
import type { Env } from './config/env';
import { requestIdMiddleware } from './common/http/request-id.middleware';
import { requestContextMiddleware } from './common/security/request-context';
import { setupSwagger } from './common/swagger';
import { MetricsService } from './common/observability/metrics.service';
import { createErrorReporter, setErrorReporter } from './common/observability/error-reporter';
import { CSRF_HEADER, REQUEST_ID_HEADER } from '@salesos/shared-types';

const WEBHOOK_PATH = /\/integrations\/(webhooks\/[^/?]+|telephony\/webhook)(\?|$)/;
const WEBHOOK_MAX_BYTES = 100_000;
function rawWebhookBody(req: Request & { rawBody?: Buffer; body?: unknown; _body?: boolean }, res: Response, next: NextFunction) {
  if (req.method !== 'POST' || !WEBHOOK_PATH.test(req.originalUrl ?? req.url)) return next();
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > WEBHOOK_MAX_BYTES) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on('error', next);
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks);
    req._body = true;
    try { req.body = JSON.parse(req.rawBody.toString('utf8')); } catch { req.body = {}; }
    next();
  });
  void res;
}

/** Shared by main.ts and the integration tests so tests exercise the real HTTP pipeline. */
export function configureApp(app: INestApplication, opts: { useLogger?: boolean } = {}) {
  const env = app.get<Env>(APP_ENV);
  const express = app as NestExpressApplication;
  if (env.TRUST_PROXY) express.set('trust proxy', 1);
  express.disable('x-powered-by');

  setErrorReporter(createErrorReporter({ dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV, release: env.RELEASE, service: 'salesos-api' }));
  app.use(requestIdMiddleware);
  app.use(app.get(MetricsService).middleware);
  app.use(requestContextMiddleware);
  if (opts.useLogger !== false) app.useLogger(app.get(Logger));

  app.use(
    helmet({
      contentSecurityPolicy: {
        // JSON API: nothing is ever rendered from it. No helmet defaults (they add style-src 'unsafe-inline', https: font/style sources ...).
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          // Swagger UI needs inline styles/scripts; only relax when docs are on (never in production, see config/env.ts).
          ...(env.docsEnabled
            ? { scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] }
            : {}),
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: env.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  // API responses carry private data: never let a browser, shared device or intermediary cache them (routes may tighten further).
  app.use('/api/v1', (_req: Request, res: Response, next: NextFunction) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(cookieParser());
  // Webhook HMAC verification needs the exact bytes. Only the two public webhook routes are read here (<= 100 kB);
  // `_body = true` tells Nest's JSON parser the body is already consumed. Owned by the platform module (Agent F).
  app.use(rawWebhookBody);

  // Strict CORS: explicit allow-list only; credentials enabled so wildcard is impossible (validated in env).
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', CSRF_HEADER, REQUEST_ID_HEADER, 'idempotency-key'],
    exposedHeaders: [REQUEST_ID_HEADER, CSRF_HEADER],
    maxAge: 600,
  });

  app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });
  if (env.docsEnabled) setupSwagger(app);
  return app;
}
