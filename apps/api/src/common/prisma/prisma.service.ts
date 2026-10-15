import { Global, Inject, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { ensureDbGuards } from './db-guards';
import { ensureSecurityGuards } from './security-guards';
import { ensureWorkforceGuards } from './workforce-guards';
import { autoDdlEnabled, verifyDbGuards } from './auto-ddl';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_ENV) env: Env) {
    super({ datasourceUrl: env.DATABASE_URL });
  }
  async onModuleInit() {
    await this.$connect();
    if (autoDdlEnabled()) { await ensureDbGuards(this); await ensureSecurityGuards(this); await ensureWorkforceGuards(this); }
    else await verifyDbGuards(this);
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
