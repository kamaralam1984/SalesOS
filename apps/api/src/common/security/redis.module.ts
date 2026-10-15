import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(@Inject(APP_ENV) env: Env) {
    super(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false });
    this.on('error', () => undefined); // surfaced through /health/ready, not process crash
  }
  async onModuleDestroy() {
    this.disconnect();
  }
  async ensureConnected() {
    if (this.status === 'wait') await this.connect();
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
