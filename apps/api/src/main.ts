import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_ENV } from './config/config.module';
import type { Env } from './config/env';
import { configureApp } from './bootstrap';
import { errorReporter } from './common/observability/error-reporter';

async function main() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  const env = app.get<Env>(APP_ENV);
  await app.listen(env.PORT, '0.0.0.0');
  // SIGTERM/SIGINT: stop accepting connections, wait for in-flight requests, close Prisma/Redis (OnModuleDestroy), exit 0.
  // (Nest's enableShutdownHooks re-raises the signal and the process then dies "by signal"; an explicit exit 0 is cleaner for orchestrators.)
  // Watchdog: if draining hangs (stuck long request) exit 1 after SHUTDOWN_GRACE_MS rather than block a rolling deploy forever.
  const graceMs = Number(process.env.SHUTDOWN_GRACE_MS ?? 25_000);
  let closing = false;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      if (closing) return;
      closing = true;
      setTimeout(() => process.exit(1), graceMs).unref();
      app.close().then(() => process.exit(0), () => process.exit(1));
    });
  }
  process.on('unhandledRejection', (reason) => {
    errorReporter().capture(reason, { status: 500 });
    console.error('unhandledRejection', reason instanceof Error ? reason.message : reason);
  });
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
