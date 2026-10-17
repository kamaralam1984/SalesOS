import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_ENV, AppConfigModule } from './config/config.module';
import type { Env } from './config/env';
import { PrismaModule } from './common/prisma';
import { AuditModule } from './common/audit/audit.service';
import { OutboxModule } from './common/outbox/outbox.service';
import { AuthzModule } from './common/authz/authz.module';
import { AppLoggerModule } from './common/logging/logger.module';
import { RedisModule, RedisService } from './common/security/redis.module';
import { RedisThrottlerStorage } from './common/security/redis-throttler.storage';
import { ObservabilityModule } from './common/observability/observability.module';
import { HealthController } from './common/health/health.controller';
import { EnvelopeInterceptor } from './common/http/envelope.interceptor';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { AuthGuard } from './common/authz/auth.guard';
import { CsrfGuard } from './common/security/csrf.guard';
import { PermissionsGuard } from './common/authz/permissions.guard';
import {
  IdentityModule, CrmModule, RevenueModule, PeopleModule, SopModule, CxModule, CollaborationModule,
  ReportingModule, NotificationsModule, FilesModule, IntegrationsModule, AiModule, DevicesModule, WorkforceModule, DevPanelModule, HomeLayoutModule,
} from './modules';

@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    PrismaModule,
    RedisModule,
    ObservabilityModule,
    AuditModule,
    OutboxModule,
    AuthzModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_ENV, RedisService],
      useFactory: (env: Env, redis: RedisService) => ({
        throttlers: [{ name: 'default', ttl: env.THROTTLE_TTL_SECONDS * 1000, limit: env.THROTTLE_LIMIT }],
        storage: env.THROTTLE_STORAGE === 'redis' ? new RedisThrottlerStorage(redis) : undefined,
      }),
    }),
    // Domain slots: each agent fills only its own folder.
    IdentityModule, CrmModule, RevenueModule, PeopleModule, SopModule, CxModule, CollaborationModule,
    ReportingModule, NotificationsModule, FilesModule, IntegrationsModule, AiModule, DevicesModule, WorkforceModule, DevPanelModule, HomeLayoutModule,
  ],
  controllers: [HealthController],
  providers: [
    // Guard order matters: rate limit -> authenticate -> CSRF -> permission (deny-by-default).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
